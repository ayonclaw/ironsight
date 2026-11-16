// Navigation: a coarse grid over the map, A* with 8-way moves, then the path is pulled straight
// wherever the sight line between two nodes is clear. Bots walk the result with steering, so they
// take lanes and doorways instead of scraping along walls.

import { pathClear } from './physics.js';

export function createNav(solids, bounds, cell = 0.7) {
  const x0 = -bounds.x;
  const z0 = -bounds.z;
  const cols = Math.ceil((bounds.x * 2) / cell);
  const rows = Math.ceil((bounds.z * 2) / cell);
  const blocked = new Uint8Array(cols * rows);
  const radius = 0.46; // a body's shoulder, so paths keep a margin off geometry

  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const cx = x0 + (i + 0.5) * cell;
      const cz = z0 + (j + 0.5) * cell;
      let solid = false;
      for (let k = 0; k < solids.length; k += 1) {
        const b = solids[k];
        // Only geometry that actually stands in the walking band blocks a cell: a kerb is low
        // enough to step over, a door lintel or a roof is high enough to walk under.
        if (b.y1 <= 0.5 || b.y0 >= 1.7) continue;
        if (cx > b.x0 - radius && cx < b.x1 + radius && cz > b.z0 - radius && cz < b.z1 + radius) {
          solid = true;
          break;
        }
      }
      blocked[j * cols + i] = solid ? 1 : 0;
    }
  }

  const index = (i, j) => j * cols + i;
  const inside = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows;
  const open = (i, j) => inside(i, j) && blocked[index(i, j)] === 0;

  function nearest(x, z) {
    let bi = Math.round((x - x0) / cell - 0.5);
    let bj = Math.round((z - z0) / cell - 0.5);
    if (open(bi, bj)) return { i: bi, j: bj };
    for (let r = 1; r <= 12; r += 1) {
      for (let dj = -r; dj <= r; dj += 1) {
        for (let di = -r; di <= r; di += 1) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          if (open(bi + di, bj + dj)) return { i: bi + di, j: bj + dj };
        }
      }
    }
    return null;
  }

  const cellX = (i) => x0 + (i + 0.5) * cell;
  const cellZ = (j) => z0 + (j + 0.5) * cell;

  // A* over the grid. Small map, few bots, so a plain array as the open set is plenty; the
  // heuristic is octile distance and ties break toward the straightest step.
  function search(from, to) {
    const start = index(from.i, from.j);
    const goal = index(to.i, to.j);
    if (start === goal) return [];
    const gScore = new Float32Array(cols * rows).fill(Infinity);
    const came = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    const openList = [start];
    const inOpen = new Uint8Array(cols * rows);
    gScore[start] = 0;
    inOpen[start] = 1;

    const h = (i, j) => {
      const di = Math.abs(i - to.i);
      const dj = Math.abs(j - to.j);
      return (di + dj) + (Math.SQRT2 - 2) * Math.min(di, dj);
    };

    let guard = 0;
    while (openList.length && guard < 20000) {
      guard += 1;
      let bestAt = 0;
      let bestF = Infinity;
      for (let n = 0; n < openList.length; n += 1) {
        const idx = openList[n];
        const i = idx % cols;
        const j = (idx - i) / cols;
        const f = gScore[idx] + h(i, j);
        if (f < bestF) { bestF = f; bestAt = n; }
      }
      const current = openList.splice(bestAt, 1)[0];
      inOpen[current] = 0;
      if (current === goal) break;
      closed[current] = 1;
      const ci = current % cols;
      const cj = (current - ci) / cols;
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (!open(ni, nj)) continue;
          // no cutting a diagonal between two blocked orthogonal neighbours
          if (di !== 0 && dj !== 0 && (!open(ci + di, cj) || !open(ci, cj + dj))) continue;
          const nIdx = index(ni, nj);
          if (closed[nIdx]) continue;
          const step = di !== 0 && dj !== 0 ? Math.SQRT2 : 1;
          const tentative = gScore[current] + step;
          if (tentative < gScore[nIdx]) {
            gScore[nIdx] = tentative;
            came[nIdx] = current;
            if (!inOpen[nIdx]) { openList.push(nIdx); inOpen[nIdx] = 1; }
          }
        }
      }
    }
    if (came[goal] === -1 && start !== goal) return null;
    const raw = [];
    let node = goal;
    while (node !== -1 && node !== start) {
      const i = node % cols;
      const j = (node - i) / cols;
      raw.push({ x: cellX(i), z: cellZ(j) });
      node = came[node];
    }
    raw.reverse();
    return raw;
  }

  // Pull the path straight: from the current anchor, take the furthest node still in sight.
  function smooth(points, startX, startZ) {
    if (!points || points.length < 2) return points ?? [];
    const out = [];
    let ax = startX;
    let az = startZ;
    let i = 0;
    while (i < points.length) {
      let best = i;
      for (let k = points.length - 1; k > i; k -= 1) {
        if (pathClear(solids, ax, az, points[k].x, points[k].z, radius)) { best = k; break; }
      }
      out.push(points[best]);
      ax = points[best].x;
      az = points[best].z;
      i = best + 1;
    }
    return out;
  }

  return {
    cell, cols, rows, bounds, blocked,
    nearest,
    isOpen(x, z) {
      const n = nearest(x, z);
      return !!n;
    },
    path(fromX, fromZ, toX, toZ) {
      const a = nearest(fromX, fromZ);
      const b = nearest(toX, toZ);
      if (!a || !b) return [];
      const raw = search(a, b);
      if (!raw) return [];
      return smooth(raw, fromX, fromZ);
    },
    // Straight-line walkability, used by the bots when they want to step out of a doorway.
    clear(fromX, fromZ, toX, toZ) {
      return pathClear(solids, fromX, fromZ, toX, toZ, radius);
    },
    // BFS from a point, for the debug readout and for asserting every spawn can reach the site.
    reach(fromX, fromZ, maxNodes = 4000) {
      const start = nearest(fromX, fromZ);
      const seen = new Set();
      if (!start) return seen;
      const queue = [start];
      seen.add(index(start.i, start.j));
      while (queue.length && seen.size < maxNodes) {
        const { i, j } = queue.pop();
        for (let dj = -1; dj <= 1; dj += 1) {
          for (let di = -1; di <= 1; di += 1) {
            if (!open(i + di, j + dj)) continue;
            const id = index(i + di, j + dj);
            if (seen.has(id)) continue;
            seen.add(id);
            queue.push({ i: i + di, j: j + dj });
          }
        }
      }
      return seen;
    },
    cellX, cellZ,
  };
}
