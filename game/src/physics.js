// Collision and tracing primitives, shared by the player, the bots and every bullet.
//
// The world is a list of axis-aligned boxes ({x0,x1,y0,y1,z0,z1,mat}), which is all a map of
// crates, walls and catwalks needs. Everything here is allocation-free in the hot path: vectors
// are numbers in, numbers out, and the few result objects are reused by the caller.

export function box(x0, z0, x1, z1, height, base = 0) {
  return {
    x0: Math.min(x0, x1), x1: Math.max(x0, x1),
    z0: Math.min(z0, z1), z1: Math.max(z0, z1),
    y0: base, y1: base + height,
  };
}

// Ray against one box. Returns the entry distance, or -1; `hit` (optional) receives the normal.
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT, hit) {
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 0;

  // X slab.
  if (Math.abs(dx) < 1e-8) {
    if (ox < b.x0 || ox > b.x1) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (b.x0 - ox) * inv;
    let t2 = (b.x1 - ox) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y slab.
  if (Math.abs(dy) < 1e-8) {
    if (oy < b.y0 || oy > b.y1) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (b.y0 - oy) * inv;
    let t2 = (b.y1 - oy) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z slab.
  if (Math.abs(dz) < 1e-8) {
    if (oz < b.z0 || oz > b.z1) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (b.z0 - oz) * inv;
    let t2 = (b.z1 - oz) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmin > maxT) return -1;
  if (hit) {
    hit.t = tmin;
    hit.nx = axis === 0 ? sign : 0;
    hit.ny = axis === 1 ? sign : 0;
    hit.nz = axis === 2 ? sign : 0;
    if (axis === -1) { hit.nx = -dx; hit.ny = -dy; hit.nz = -dz; }
  }
  return tmin;
}

// Nearest world hit along a ray. `out` is reused: {t, nx, ny, nz, box}.
export function traceWorld(boxes, ox, oy, oz, dx, dy, dz, maxT, out) {
  let best = maxT;
  let found = null;
  const hit = { t: 0, nx: 0, ny: 0, nz: 0 };
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    const t = rayBox(ox, oy, oz, dx, dy, dz, b, best, hit);
    if (t >= 0 && t < best) {
      best = t;
      found = b;
      out.nx = hit.nx; out.ny = hit.ny; out.nz = hit.nz;
    }
  }
  out.t = found ? best : -1;
  out.box = found;
  return found ? best : -1;
}

// Is the straight line between two points clear at eye height? Used for bot vision and for
// smoothing a navigation path into a walkable line.
export function lineClear(boxes, x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return true;
  const hit = { t: 0, nx: 0, ny: 0, nz: 0 };
  for (let i = 0; i < boxes.length; i += 1) {
    if (rayBox(x0, y0, z0, dx / len, dy / len, dz / len, boxes[i], len, hit) >= 0) return false;
  }
  return true;
}

// The highest surface under a circle — the floor is 0, crates and catwalks add to it.
export function groundAt(boxes, x, z, radius, feetY, stepUp) {
  let best = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    if (b.y1 > feetY + stepUp) continue;
    if (b.y1 <= best) continue;
    if (x + radius < b.x0 || x - radius > b.x1) continue;
    if (z + radius < b.z0 || z - radius > b.z1) continue;
    best = b.y1;
  }
  return best;
}

// Push a circle out of the boxes that stand taller than its step height. Axis-separated: the
// caller moves X, calls this, moves Z, calls this. Resolves the smallest axis, which keeps a body
// sliding along a wall instead of sticking to it.
export function resolveCircle(boxes, pos, radius, feetY, height) {
  const headY = feetY + height;
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    if (b.y1 <= feetY + 0.32 || b.y0 >= headY) continue;
    const cx = Math.max(b.x0, Math.min(pos.x, b.x1));
    const cz = Math.max(b.z0, Math.min(pos.z, b.z1));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // Centre inside the box: escape through the nearest face.
      const left = pos.x - b.x0;
      const right = b.x1 - pos.x;
      const front = pos.z - b.z0;
      const back = b.z1 - pos.z;
      const m = Math.min(left, right, front, back);
      if (m === left) pos.x = b.x0 - radius;
      else if (m === right) pos.x = b.x1 + radius;
      else if (m === front) pos.z = b.z0 - radius;
      else pos.z = b.z1 + radius;
    }
  }
}

// Bots walk the navigation graph, so all they need is: does a 2D segment stay out of geometry
// taller than a low step (crates, walls)? Cheap, and it not caring about Y is fine on one floor.
export function pathClear(boxes, x0, z0, x1, z1, radius) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return true;
  const steps = Math.ceil(len / 0.35);
  for (let s = 1; s <= steps; s += 1) {
    const px = x0 + (dx * s) / steps;
    const pz = z0 + (dz * s) / steps;
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      if (b.y1 <= 0.45 || b.y0 >= 1.7) continue; // step over it, or walk under it
      if (px > b.x0 - radius && px < b.x1 + radius && pz > b.z0 - radius && pz < b.z1 + radius) return false;
    }
  }
  return true;
}
