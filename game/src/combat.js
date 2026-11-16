// Gunplay: the loadout, the accuracy model and the bullet trace. Everything that shoots — the
// player and every bot — goes through `shoot()`, so the same recoil, falloff and armour rules
// decide every fight.
//
// Accuracy is the design centre: a weapon at rest is precise, moving blooms the cone, each shot
// blooms it further, and only standing still (or crouching) brings it back. The first bullet out
// of a cold barrel is always the true one.

import { WEAPONS, clamp } from './config.js';
import { rayBox } from './physics.js';

// A loadout: what you own, what is loaded, and what you are holding. Money lives with the match,
// but everything bought lives here, so the reset at the top of a round is one call.
export function createArsenal(team) {
  const mags = {};
  const reserves = {};
  for (const key of Object.keys(WEAPONS)) {
    mags[key] = WEAPONS[key].mag;
    reserves[key] = WEAPONS[key].reserve;
  }
  const arsenal = {
    team,
    owned: { primary: null, sidearm: 'p9' },
    armour: 0,
    helmet: false,
    kit: false,
    current: 'p9',
    mags,
    reserves,
    reloading: 0,
    shotIndex: 0,
    spreadBloom: 0,
    sinceShot: 99,

    reset() {
      arsenal.owned = { primary: null, sidearm: 'p9' };
      arsenal.armour = 0;
      arsenal.helmet = false;
      arsenal.kit = false;
      arsenal.current = 'p9';
      for (const key of Object.keys(WEAPONS)) {
        mags[key] = WEAPONS[key].mag;
        reserves[key] = WEAPONS[key].reserve;
      }
      arsenal.reloading = 0;
      arsenal.shotIndex = 0;
      arsenal.spreadBloom = 0;
      arsenal.sinceShot = 99;
    },

    // Buy a gun. Returns true when it went through (money is the caller's business).
    buy(key) {
      const w = WEAPONS[key];
      if (!w) return false;
      if (w.slot === 'primary') {
        arsenal.owned.primary = key;
      } else {
        arsenal.owned.sidearm = key;
      }
      mags[key] = w.mag;
      reserves[key] = w.reserve;
      arsenal.current = key;
      arsenal.reloading = 0;
      arsenal.shotIndex = 0;
      arsenal.spreadBloom = 0;
      return true;
    },

    buyGear(key) {
      if (key === 'vest') {
        if (arsenal.helmet) return false;
        arsenal.armour = 100;
        return true;
      }
      if (key === 'helmet') {
        arsenal.armour = 100;
        arsenal.helmet = true;
        return true;
      }
      if (key === 'kit') {
        if (team !== 'warden') return false;
        arsenal.kit = true;
        return true;
      }
      return false;
    },

    owns(key) {
      if (key === 'vest') return arsenal.armour > 0 && !arsenal.helmet;
      if (key === 'helmet') return arsenal.helmet;
      if (key === 'kit') return arsenal.kit;
      const w = WEAPONS[key];
      if (!w) return false;
      return arsenal.owned[w.slot] === key;
    },

    weapon() {
      return WEAPONS[arsenal.current];
    },

    // Switch to the best thing you own (used at spawn and after a buy).
    equipBest() {
      arsenal.current = arsenal.owned.primary || arsenal.owned.sidearm;
      arsenal.shotIndex = 0;
      arsenal.spreadBloom = 0;
      arsenal.reloading = 0;
    },

    equip(key) {
      if (!key || key === arsenal.current) return false;
      const w = WEAPONS[key];
      if (!w) return false;
      if (arsenal.owned[w.slot] !== key) return false;
      arsenal.current = key;
      arsenal.reloading = 0;
      arsenal.shotIndex = 0;
      arsenal.spreadBloom = 0;
      return true;
    },

    // Refill at the top of a round: mags come back, reserves top up, but nothing is free.
    topUp() {
      const w = arsenal.weapon();
      if (!w) return;
      mags[w.key] = w.mag;
      reserves[w.key] = Math.max(reserves[w.key], Math.floor(w.reserve * 0.5));
    },

    startReload() {
      const w = WEAPONS[arsenal.current];
      if (!w || arsenal.reloading > 0) return false;
      if (mags[w.key] >= w.mag || reserves[w.key] <= 0) return false;
      arsenal.reloading = w.reload;
      return true;
    },

    finishReload() {
      const w = WEAPONS[arsenal.current];
      if (!w) return;
      const need = w.mag - mags[w.key];
      const take = Math.min(need, reserves[w.key]);
      mags[w.key] += take;
      reserves[w.key] -= take;
      arsenal.reloading = 0;
      arsenal.shotIndex = 0;
      arsenal.spreadBloom = 0;
    },

    consume() {
      const w = WEAPONS[arsenal.current];
      if (!w) return false;
      if (arsenal.reloading > 0) return false;
      if (mags[w.key] <= 0) {
        arsenal.startReload();
        return false;
      }
      mags[w.key] -= 1;
      return true;
    },

    // The cone, in degrees, right now: base + movement + air + the bloom of the burst so far.
    spread(moveSpeed, crouching, airborne) {
      const w = WEAPONS[arsenal.current];
      const moveRatio = clamp(moveSpeed / 5.9, 0, 1);
      let value = w.spread + moveRatio * w.spreadMove + (airborne ? w.spreadAir : 0) + arsenal.spreadBloom;
      if (crouching) value *= w.spreadCrouch;
      return Math.min(value, w.spreadMax + 1.5);
    },
  };
  return arsenal;
}

// Recoil is a view kick that accumulates while the trigger is held and springs back when it is
// released. The pattern is deterministic per weapon, so a player who learns it can hold a spray
// down; anyone who does not is punished with a crosshair in the sky.
export const RECOIL_SCALE = 0.62;

export function recoilFor(weapon, shotIndex) {
  const pattern = weapon.pattern;
  const p = pattern[Math.min(shotIndex, pattern.length - 1)];
  // past the pattern, keep walking with a little seeded wobble so stamina never repeats exactly
  const extra = Math.max(0, shotIndex - pattern.length + 1) * 0.06;
  return {
    yaw: (p[0] + Math.sin(shotIndex * 2.7) * extra) * RECOIL_SCALE,
    pitch: (p[1] + extra * 0.4) * RECOIL_SCALE,
  };
}

// ---------------------------------------------------------------------------------------------
// Ballistics. Actors expose { team, alive, pos, crouch, hit(damage, zone, weapon, dirX, dirZ) }
// and the world is the same box list the map built for collision.
// ---------------------------------------------------------------------------------------------

const HEAD_RADIUS = 0.2;
const BODY_HALF = 0.29;
const LEG_HALF = 0.25;

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) {
  const mx = ox - cx;
  const my = oy - cy;
  const mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return -1;
  return t;
}

// Head sphere first, then torso and legs as boxes — one call per body per pellet.
export function traceActor(actor, ox, oy, oz, dx, dy, dz, maxT) {
  if (!actor.alive) return null;
  const p = actor.pos;
  const crouch = actor.crouch;
  const eye = p.y + (crouch ? 1.1 : 1.62);
  const headR = crouch ? HEAD_RADIUS * 0.82 : HEAD_RADIUS;
  const tHead = raySphere(ox, oy, oz, dx, dy, dz, p.x, eye, p.z, headR);
  if (tHead >= 0 && tHead < maxT) return { t: tHead, zone: 'head' };

  const torsoTop = eye - headR * 1.3;
  const torsoBottom = p.y + (crouch ? 0.5 : 0.86);
  const legsTop = torsoBottom;
  const legsBottom = p.y + 0.04;

  // body box
  let best = maxT;
  let zone = null;
  let nx = 0; let ny = 0; let nz = 0;
  const hit = { t: 0, nx: 0, ny: 0, nz: 0 };
  const torso = {
    x0: p.x - BODY_HALF, x1: p.x + BODY_HALF, z0: p.z - BODY_HALF * 0.72, z1: p.z + BODY_HALF * 0.72,
    y0: torsoBottom, y1: torsoTop,
  };
  let t = rayBox(ox, oy, oz, dx, dy, dz, torso, best, hit);
  if (t >= 0 && t < best) { best = t; zone = 'body'; nx = hit.nx; ny = hit.ny; nz = hit.nz; }
  const legs = {
    x0: p.x - LEG_HALF, x1: p.x + LEG_HALF, z0: p.z - LEG_HALF * 0.8, z1: p.z + LEG_HALF * 0.8,
    y0: legsBottom, y1: legsTop,
  };
  t = rayBox(ox, oy, oz, dx, dy, dz, legs, best, hit);
  if (t >= 0 && t < best) { best = t; zone = 'leg'; nx = hit.nx; ny = hit.ny; nz = hit.nz; }
  if (!zone) return null;
  return { t: best, zone, nx, ny, nz };
}

export function createGunplay({ solids, effects, audio, rng, onEvent }) {
  const worldHit = { t: 0, nx: 0, ny: 0, nz: 0, box: null };

  function damageScale(weapon, distance) {
    const [near, far, floor] = weapon.falloff;
    if (distance <= near) return 1;
    if (distance >= far) return floor;
    const k = (distance - near) / (far - near);
    return 1 + (floor - 1) * k;
  }

  // One trigger pull. `spreadDeg` is the cone half-angle the shooter has earned; `origin` is the
  // muzzle (for the tracer) and `aim` the camera point the shot is sent through.
  function shoot({ origin, dir, weapon, shooter, spreadDeg, targets, tracerFrom }) {
    let hitActor = null;
    let hitZone = null;
    let hitAny = false;
    let killed = false;
    const pellets = weapon.pellets || 1;

    for (let p = 0; p < pellets; p += 1) {
      // random point in the cone
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * (spreadDeg * Math.PI) / 180;
      let dx = dir.x;
      let dy = dir.y;
      let dz = dir.z;
      // build a basis around the aim direction and tilt it
      const upX = Math.abs(dy) > 0.95 ? 1 : 0;
      const upY = Math.abs(dy) > 0.95 ? 0 : 1;
      const upZ = 0;
      // right = dir × up
      let rx = dy * upZ - dz * upY;
      let ry = dz * upX - dx * upZ;
      let rz = dx * upY - dy * upX;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      // true up = right × dir
      const ux = ry * dz - rz * dy;
      const uy = rz * dx - rx * dz;
      const uz = rx * dy - ry * dx;
      const cosA = Math.cos(a) * r;
      const sinA = Math.sin(a) * r;
      dx += rx * cosA + ux * sinA;
      dy += ry * cosA + uy * sinA;
      dz += rz * cosA + uz * sinA;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl; dy /= dl; dz /= dl;

      const maxT = 140;
      let bestT = 140;
      let kind = null;
      let zone = null;
      let nx = 0; let ny = 0; let nz = 0;
      let victim = null;

      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i];
        if (!target.alive || target.team === shooter.team) continue;
        const res = traceActor(target, origin.x, origin.y, origin.z, dx, dy, dz, bestT);
        if (res && res.t < bestT) {
          bestT = res.t;
          kind = 'actor';
          zone = res.zone;
          victim = target;
          nx = res.nx; ny = res.ny; nz = res.nz;
        }
      }

      // world is checked after bodies only to keep the nearest-hit comparison honest
      for (let i = 0; i < solids.length; i += 1) {
        const t = rayBox(origin.x, origin.y, origin.z, dx, dy, dz, solids[i], bestT, worldHit);
        if (t >= 0 && t < bestT) {
          bestT = t;
          kind = 'world';
          victim = null;
          nx = worldHit.nx; ny = worldHit.ny; nz = worldHit.nz;
        }
      }

      const hx = origin.x + dx * bestT;
      const hy = origin.y + dy * bestT;
      const hz = origin.z + dz * bestT;

      if (tracerFrom) {
        effects.tracer(tracerFrom.x, tracerFrom.y, tracerFrom.z, hx, hy, hz);
      } else {
        effects.tracer(origin.x, origin.y - 0.06, origin.z, hx, hy, hz);
      }

      if (kind === 'actor' && victim) {
        const dist = bestT;
        const falloff = damageScale(weapon, dist);
        let dmg = weapon.damage * falloff;
        if (zone === 'head') dmg *= weapon.headMult;
        else if (zone === 'leg') dmg *= weapon.legMult;
        victim.hit(dmg, zone, weapon, dx, dz, shooter);
        effects.impact(hx, hy, hz, -dx, -dy, -dz, 'flesh');
        hitActor = victim;
        hitZone = zone;
        hitAny = true;
        if (!victim.alive) killed = true;
      } else if (kind === 'world') {
        const box = worldHit.box;
        const mat = box && box.mat;
        effects.impact(hx, hy, hz, nx, ny, nz, mat === 'crate' || mat === 'barrel' ? 'metal' : 'concrete');
      }
      // a stray round into the sky makes no decal and no sound: the crack is the shot itself
    }

    // A small camera kick, scaled by the weapon, is felt by the player; bots get theirs elsewhere.
    onEvent({ type: 'shot', shooter, weapon, hit: hitAny, killed, victim: hitActor, zone: hitZone, pellets });
    return { hit: hitAny, killed, victim: hitActor, zone: hitZone };
  }

  return { shoot, damageScale };
}
