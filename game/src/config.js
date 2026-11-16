// IRONSIGHT — every tunable number lives here: the look, the movement, the guns, the economy and
// the round clock. Nothing here touches three.js or the DOM, so the whole design can be read (and
// rebalanced) in one file. Units are metres, seconds and degrees unless a name says otherwise.

// The light: a foundry yard at dusk. Cold sky, sodium lamps, rust and concrete. Six hues, and the
// materials in map.js are built from them.
export const PALETTE = {
  sky: '#16232c',
  fog: '#1b2a33',
  concrete: '#5c625f',
  concreteDark: '#3d4341',
  metal: '#4a5257',
  rust: '#7a4a33',
  accent: '#ffb03a',
  warden: '#5cc8f0',
  cinder: '#ff7a42',
  ink: '#e8eef0',
  muted: '#8a999f',
  danger: '#e04a38',
  heal: '#59c99a',
};

// The two sides. The player is WARDEN (defenders); CINDER attacks the site with a breach charge.
export const TEAMS = {
  warden: { id: 'warden', name: 'WARDEN', short: 'WDN', color: PALETTE.warden, css: 'wden' },
  cinder: { id: 'cinder', name: 'CINDER', short: 'CDR', color: PALETTE.cinder, css: 'cdr' },
};

export const MATCH = {
  teamSize: 5,
  roundsToWin: 8,
  buyTime: 20,
  roundTime: 105,
  freezeTime: 2.2, // movement held at the top of the round while the buy menu is open
  roundEndTime: 5.2,
  plantTime: 3.2,
  fuseTime: 40,
  defuseTime: 10,
  defuseKitTime: 5,
  plantRadius: 1.4,
  maxRounds: 30,
};

// Money is the whole point of the buy phase: you keep it, you save it, and losing pays a little
// more each round so a bad half is recoverable.
export const ECONOMY = {
  start: 800,
  max: 16000,
  win: 3250,
  lossBase: 1400,
  lossStep: 500,
  lossCap: 3400,
  plantReward: 300,
  defuseReward: 300,
};

// Equipment. `grants` says what the purchase puts in the loadout.
export const GEAR = {
  vest: { key: 'vest', name: 'Kevlar Vest', price: 650, kind: 'gear', tag: 'ARMOUR', blurb: 'Absorbs half of body damage until it is shredded.' },
  helmet: { key: 'helmet', name: 'Vest + Helmet', price: 1000, kind: 'gear', tag: 'ARMOUR', blurb: 'Kevlar plus a helmet: headshots stop one-tapping you.', grants: 'helmet' },
  kit: { key: 'kit', name: 'Defuse Kit', price: 400, kind: 'gear', tag: 'UTILITY', blurb: 'Halves the time you need on the charge. Defenders only.' },
};

// Guns. `spread` values are cone half-angles in degrees; `pattern` is the deterministic spray
// walked per shot (x = horizontal, y = vertical climb) — the first bullet is always true, so the
// skill is in trigger discipline, not in the sprint.
export const WEAPONS = {
  p9: {
    key: 'p9', name: 'Kestrel P9', slot: 'sidearm', tag: 'PISTOL', price: 0, auto: false,
    damage: 27, headMult: 3.6, legMult: 0.72, armourPen: 0.5, pellets: 1,
    rpm: 400, mag: 20, reserve: 80, reload: 1.7, killReward: 300,
    spread: 0.55, spreadMove: 2.4, spreadAir: 6.5, spreadShot: 0.75, spreadMax: 5.0, spreadCrouch: 0.65, recover: 7.5,
    pattern: [[0.1, 1.05], [-0.2, 0.9], [0.25, 0.85], [-0.3, 0.8], [0.4, 0.75], [-0.35, 0.7]],
    recoilRecover: 11, falloff: [20, 55, 0.72], speed: 1.0,
  },
  vesper: {
    key: 'vesper', name: 'Vesper-9 SMG', slot: 'primary', tag: 'SMG', price: 1250, auto: true,
    damage: 22, headMult: 3.1, legMult: 0.75, armourPen: 0.42, pellets: 1,
    rpm: 800, mag: 30, reserve: 120, reload: 2.1, killReward: 600,
    spread: 0.95, spreadMove: 1.9, spreadAir: 8, spreadShot: 0.5, spreadMax: 6.4, spreadCrouch: 0.7, recover: 9,
    pattern: [[0.3, 0.62], [-0.35, 0.58], [0.4, 0.55], [-0.45, 0.5], [0.5, 0.48], [-0.55, 0.44], [0.6, 0.4], [-0.5, 0.38]],
    recoilRecover: 13, falloff: [14, 34, 0.55], speed: 1.04,
  },
  halberd: {
    key: 'halberd', name: 'Halberd AR', slot: 'primary', tag: 'RIFLE', price: 2700, auto: true,
    damage: 35, headMult: 3.9, legMult: 0.72, armourPen: 0.55, pellets: 1,
    rpm: 600, mag: 30, reserve: 90, reload: 2.5, killReward: 300,
    spread: 0.14, spreadMove: 3.4, spreadAir: 11, spreadShot: 1.05, spreadMax: 7.2, spreadCrouch: 0.7, recover: 6.2,
    // The first four rounds go nearly straight up; from there the rifle walks left, then right.
    pattern: [
      [0.05, 1.35], [-0.08, 1.3], [0.12, 1.25], [-0.15, 1.2], [0.2, 1.15], [0.3, 1.05],
      [-0.55, 1.0], [-0.95, 0.95], [-1.15, 0.9], [-0.9, 0.85], [0.2, 0.8], [0.85, 0.72],
      [1.2, 0.66], [1.35, 0.6], [1.0, 0.55], [0.3, 0.5], [-0.5, 0.45], [-1.1, 0.4],
      [-1.25, 0.35], [-1.0, 0.3], [-0.5, 0.26], [0.2, 0.22], [0.9, 0.18], [1.15, 0.14],
      [0.95, 0.1], [0.4, 0.08], [-0.3, 0.06], [-0.9, 0.05], [-1.0, 0.04], [-0.6, 0.03],
    ],
    recoilRecover: 8.5, falloff: [26, 70, 0.8], speed: 0.94,
  },
  breakwater: {
    key: 'breakwater', name: 'Breakwater 12', slot: 'primary', tag: 'SHOTGUN', price: 1100, auto: false,
    damage: 13, headMult: 2.2, legMult: 0.8, armourPen: 0.35, pellets: 8,
    rpm: 75, mag: 7, reserve: 28, reload: 2.9, killReward: 900,
    spread: 3.4, spreadMove: 0.9, spreadAir: 4, spreadShot: 0.6, spreadMax: 6.0, spreadCrouch: 0.9, recover: 12,
    pattern: [[0.6, 2.4], [-0.7, 2.2], [0.9, 2.0], [-1.0, 1.8], [1.1, 1.6]],
    recoilRecover: 12, falloff: [7, 20, 0.28], speed: 0.97,
  },
};

// How bodies move. `walkSpeed` is the accurate one (hold shift); running is fast and heard.
export const BODY = {
  radius: 0.38,
  height: 1.76,
  eye: 1.62,
  crouchEye: 1.12,
  crouchHeight: 1.24,
  runSpeed: 5.9,
  walkSpeed: 3.15,
  crouchSpeed: 2.25,
  accel: 62,
  friction: 12,
  airAccel: 9,
  gravity: 22,
  jumpSpeed: 6.35,
  stepUp: 0.42,
};

// Bots. Reaction is the delay before the first round leaves the barrel after a target appears;
// `aimError` is the cone they shoot inside at the start of an engagement, decaying to `aimFloor`.
export const BOT = {
  radius: 0.4,
  height: 1.78,
  reaction: [0.26, 0.46],
  aimError: [2.4, 3.6],
  aimFloor: [0.9, 1.6],
  settle: 1.5,
  burst: [3, 7],
  burstPause: [0.28, 0.62],
  viewRange: 62,
  fov: 118,
  hearing: 26,
  strafeChance: 0.55,
  think: 0.16,
};

// Copy that reads on screen.
export const IDENTITY = {
  title: 'IRONSIGHT',
  subtitle: 'Round-based tactical FPS',
  map: 'FOUNDRY 9',
  mapLine: 'A dusk-shift casting yard. One site, three ways in, no respawns.',
  objective: 'BREACH CHARGE',
  site: 'SITE A',
  tagline: 'Five against five. Money carries. Accuracy decides.',
};

// Small math helpers shared by every module (kept here so nothing re-implements them).
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const randRange = (rng, [lo, hi]) => lo + (hi - lo) * rng();
export const rad = (degrees) => (degrees * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;

// Deterministic RNG (mulberry32) so a seeded capture replays the same match every time.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const money = (value) => `$${Math.round(value).toLocaleString('en-US')}`;
export const clock = (seconds) => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
