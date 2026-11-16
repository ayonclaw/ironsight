// Every tunable number for IRONSIGHT in one place, plus the deterministic RNG the ?shot captures
// seed so a screenshot is the same frame every run. Nothing here touches three.js or the DOM.

// The look: a cold blue-grey bunker lit by warm sodium lamps and the player's amber weapon light.
// Six hues, everything else is these values under the scene's lights.
export const PALETTE = {
  canvas: '#0d1114',
  surface: '#1a2228',
  hairline: '#2a343d',
  ink: '#dfe7ea',
  muted: '#7f8f98',
  accent: '#ffb03a',
  danger: '#e2563c',
  heal: '#5fcfa0',
  glow: '#7fd8ff',
};

// Movement and body.
export const PLAYER = {
  radius: 0.36,
  standHeight: 1.74,
  crouchHeight: 1.14,
  standEye: 1.62,
  crouchEye: 1.04,
  walkSpeed: 5.4,
  sprintSpeed: 7.9,
  crouchSpeed: 2.5,
  groundAccel: 46,
  airAccel: 8,
  friction: 11,
  gravity: 21,
  jumpSpeed: 6.4,
  maxHealth: 100,
  regenDelay: 6.5,
  regenRate: 7,
  bobRate: 9.5,
  bobAmount: 0.035,
};

// The rifle: hitscan, 30 rounds, ~9 rounds a second, tight when still and loose when sprinting.
export const WEAPON = {
  magSize: 30,
  reserveMax: 210,
  fireGap: 0.108,
  reloadTime: 1.62,
  spreadStill: 0.0016,
  spreadMoving: 0.032,
  spreadPerShot: 0.0055,
  spreadMax: 0.055,
  spreadRecover: 0.09,
  moveReference: 6.0,
  recoilPitch: 0.0115,
  recoilYaw: 0.0035,
  damageBody: 26,
  damageHead: 78,
  damageLimb: 19,
  range: 90,
  muzzleSeconds: 0.055,
};

// Enemy archetypes. speed in m/s, health in hit points, radius for the player's collision.
export const ENEMY_TYPES = {
  drifter: { health: 62, speed: 2.5, radius: 0.44, height: 1.62, damage: 8, score: 100, color: '#2f5f7d', speedJitter: 0.22 },
  sprinter: { health: 40, speed: 4.6, radius: 0.34, height: 1.34, damage: 7, score: 140, color: '#9c2f47', speedJitter: 0.3 },
  brute: { health: 210, speed: 1.55, radius: 0.72, height: 2.25, damage: 24, score: 320, color: '#6a45a8', speedJitter: 0.1 },
  spitter: { health: 78, speed: 1.95, radius: 0.42, height: 1.7, damage: 0, score: 210, color: '#a8711f', speedJitter: 0.15, ranged: true },
};

// Wave shape: counts ramp, health and speed scale, a breather between waves, a telegraph first.
export const WAVES = {
  firstWave: 6,
  growth: 2.6,
  maxAlive: 14,
  spawnGapStart: 1.15,
  spawnGapMin: 0.42,
  telegraph: 1.5,
  intermission: 4.6,
  healthScale: 0.085,
  speedScale: 0.028,
  speedCap: 1.42,
  bossEvery: 4,
};

export const ARENA = {
  half: 15.5,
  wallHeight: 6.0,
};

// Basket counts; the hot loop reuses pools and never allocates.
export const LIMITS = {
  particles: 520,
  tracers: 40,
  decals: 36,
  labels: 14,
};

export function mulberry32(initial) {
  let a = initial >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
