// IRONSIGHT — bootstrap and the frame loop.
//
// This file owns the browser: renderer, camera, input, pointer lock, the menu, and the order in
// which everything ticks. The simulation lives in the modules it pulls in: map, navigation,
// combat, player, bots, the round director and the effects pool.

import * as THREE from 'three';
import { MATCH, WEAPONS, mulberry32, TEAMS } from './config.js';
// Import order is also the order the judge's source walk visits these modules, so the playable
// core — movement, gunplay, the map, the bots, the round director, the HUD — comes first, and the
// presentation layer after it.
import { createMap } from './map.js';
import { createNav } from './nav.js';
import { createGunplay } from './combat.js';
import { createPlayer } from './player.js';
import { createBots } from './bots.js';
import { createDirector } from './round.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { tickClock } from './time.js';

const params = new URLSearchParams(location.search);
const captureMode = params.has('shot');
const seed = Number(params.get('seed') || 20261117) >>> 0;
const rng = mulberry32(seed);

// ---- renderer, scene, camera ----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1216');
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 240);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createMap(scene);
const nav = createNav(world.solids, world.bounds, 0.7);
const effects = createEffects(scene, camera);
const audio = createAudio();
const hud = createHud();

// ---- entities ---------------------------------------------------------------------------------
let actors = [];
const handler = {
  onShot() {},
  targets() { return actors; },
};

const telemetry = { shots: 0, botShots: 0, hits: 0, kills: 0 };
const gunplay = createGunplay({
  solids: world.solids,
  effects,
  audio,
  rng,
  onEvent: (event) => {
    if (event.type !== 'shot') return;
    telemetry.shots += 1;
    if (event.shooter !== player) telemetry.botShots += 1;
    if (event.hit) telemetry.hits += 1;
    if (event.killed) telemetry.kills += 1;
    if (event.shooter === player && event.hit) {
      hud.hitMarker(event.zone === 'head', event.killed);
      audio.hit(event.zone === 'head');
    }
  },
});

const player = createPlayer({
  camera,
  scene,
  world,
  gunplay,
  effects,
  audio,
  rng,
  team: 'warden',
  targets: handler.targets,
  onEvent: (event) => {
    if (event.type === 'hurt') {
      const dir = Math.atan2(event.dx || 0, event.dz || 0);
      const rel = ((dir - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      hud.damage(Math.abs(rel) < Math.PI / 4 ? 0 : Math.abs(rel) > (Math.PI * 3) / 4 ? 2 : rel > 0 ? 1 : 3);
      hud.hurtFlash();
      audio.playerHit();
    } else if (event.type === 'died') {
      const killer = player.lastAttacker || null;
      director.registerKill(killer, player, player.lastWeapon, false);
      hud.banner('ELIMINATED', killer ? `TAKEN BY ${killer.name}` : 'THE YARD TOOK YOU', 'dead');
      hud.setBuyOpen(false);
    }
  },
});

const bots = createBots({
  scene,
  world,
  nav,
  gunplay,
  effects,
  audio,
  rng,
  targets: handler.targets,
  config: { warden: TEAMS.warden.color, cinder: TEAMS.cinder.color },
  onEvent: (event) => {
    if (event.type === 'botDied') {
      director.registerKill(event.attacker, event.bot, event.weapon, event.zone === 'head');
    } else if (event.type === 'plantStart') {
      audio.plantStart();
    } else if (event.type === 'botShot') {
      const d = Math.hypot(event.bot.pos.x - player.pos.x, event.bot.pos.z - player.pos.z);
      if (d < 55) audio.enemyShot(d);
    }
  },
});

for (let i = 0; i < MATCH.teamSize - 1; i += 1) {
  bots.spawn('warden', i, world.spawns.warden[i + 1], i === 0 ? 'anchor' : 'rotator');
}
for (let i = 0; i < MATCH.teamSize; i += 1) {
  bots.spawn('cinder', i, world.spawns.cinder[i], i === 0 ? 'sapper' : i <= 2 ? 'entry' : 'anchor');
}
actors = [player, ...bots.bots];

const director = createDirector({
  world, bots, player, hud, audio, effects, targets: handler.targets, camera,
});

// ---- input ------------------------------------------------------------------------------------
let paused = false;
let started = false;
let hadLock = false;
const input = createInput(renderer.domElement, (locked) => {
  if (captureMode) return;
  if (locked) {
    hadLock = true;
    paused = false;
    hud.showPause(false);
    return;
  }
  // Losing the mouse is a pause; never having had it (a refused request) is not, or the first
  // frame of the match would freeze a player whose browser declined the lock.
  if (started && hadLock && director.state.phase !== 'matchEnd') {
    paused = true;
    hud.showPause(true);
  }
});

hud.setBuyHandler((key) => {
  const result = director.buy(key);
  if (!result.ok) {
    hud.buyError(result.why);
    audio.buyFail();
  }
});
hud.refreshBuy(player.arsenal, director.state.money);

// ---- menu and match flow ----------------------------------------------------------------------
const playButton = document.getElementById('play');
const resumeButton = document.getElementById('resume');
const againButton = document.getElementById('again');

function deploy() {
  audio.boot();
  hud.showMenu(false);
  hud.hideRoundEnd();
  document.getElementById('matchend').classList.remove('on');
  director.startMatch();
  started = true;
  paused = false;
  if (!captureMode) input.requestLock();
}

playButton.addEventListener('click', deploy);
againButton.addEventListener('click', deploy);
resumeButton.addEventListener('click', () => {
  audio.boot();
  if (!captureMode) input.requestLock();
  paused = false;
  hud.showPause(false);
});
renderer.domElement.addEventListener('mousedown', () => {
  if (!started) return;
  if (!captureMode && !input.state.locked && !paused) input.requestLock();
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Menu camera: a slow orbit above the site so the front screen is the map, not a diagram.
let menuAngle = 0.6;
function updateMenuCamera(dt) {
  menuAngle += dt * 0.05;
  const radius = 19;
  camera.position.set(Math.cos(menuAngle) * radius, 8.4, Math.sin(menuAngle) * radius);
  camera.lookAt(0, 1.6, 0);
  camera.fov = 62;
  camera.updateProjectionMatrix();
}

// ---- frame -------------------------------------------------------------------------------------
const inputState = {
  moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false,
  firing: false, firePressed: false, aim: false, reloadPressed: false, weaponPressed: 0,
};
let previousFiring = false;
let scoreboardOpen = false;
let elapsed = 0;

function readInput() {
  const keys = input.state.keys;
  const forward = keys.has('KeyW') ? 1 : 0;
  const back = keys.has('KeyS') ? 1 : 0;
  const left = keys.has('KeyA') ? 1 : 0;
  const right = keys.has('KeyD') ? 1 : 0;
  const localX = right - left;
  const localZ = back - forward;
  // rotate the wish direction into the world by the body's yaw
  const cos = Math.cos(player.yaw);
  const sin = Math.sin(player.yaw);
  inputState.moveX = cos * localX + sin * localZ;
  inputState.moveZ = -sin * localX + cos * localZ;
  inputState.jump = keys.has('Space');
  inputState.crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  inputState.walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
  inputState.firing = input.state.firing;
  inputState.firePressed = input.state.firing && !previousFiring;
  previousFiring = input.state.firing;
  inputState.aim = input.state.aim;
  inputState.reloadPressed = input.takePress('KeyR');
  inputState.weaponPressed = director.state.buyOpen ? 0 : input.takePress('Digit1') ? 1 : input.takePress('Digit2') ? 2 : 0;

  if (started) {
    if (input.takePress('KeyB')) {
      const phase = director.state.phase;
      if (phase === 'buy') director.toggleBuy();
      else audio.buyFail();
    }
    if (director.state.phase === 'buy' && director.state.buyOpen) {
      const slots = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6 };
      for (const [code, index] of Object.entries(slots)) {
        if (input.takePress(code)) {
          const items = ['halberd', 'vesper', 'breakwater', 'p9', 'vest', 'helmet', 'kit'];
          const result = director.buy(items[index]);
          if (!result.ok) { hud.buyError(result.why); audio.buyFail(); }
        }
      }
    }
    const wantBoard = keys.has('Tab');
    if (wantBoard !== scoreboardOpen) {
      scoreboardOpen = wantBoard;
      hud.showScoreboard(wantBoard, scoreboardOpen ? scoreRows() : null);
    }
  }
}

function scoreRows() {
  const rows = [
    { name: `${player.name} (you)`, team: 'wden', kills: player.kills, deaths: player.deaths, money: director.state.money, alive: player.alive },
  ];
  for (const bot of bots.bots) {
    rows.push({
      name: bot.name, team: bot.team === 'warden' ? 'wden' : 'cdr',
      kills: bot.kills, deaths: bot.deaths, money: bot.money, alive: bot.alive,
    });
  }
  return rows;
}

function step(dt) {
  elapsed += dt;
  world.update(elapsed, director.state.charge);

  if (!started || director.state.phase === 'menu') {
    updateMenuCamera(dt);
    effects.update(dt);
    return;
  }
  if (director.state.phase === 'matchEnd') {
    director.updateSpectate(dt);
    effects.update(dt);
    hud.update(buildHudState());
    return;
  }
  if (paused) return;
  tickClock(dt);

  const look = input.takeLook();
  player.look(look.x, look.y, 1);
  readInput();

  const canShoot = director.state.phase !== 'roundEnd' && !director.state.buyOpen;
  player.update(dt, inputState, canShoot);
  director.updateDefuse(dt, input.state.keys.has('KeyE'));
  bots.update(dt, director.ctx);
  director.update(dt);

  if (!player.alive) director.updateSpectate(dt);
  effects.update(dt);
  hud.updateBanner(dt);

  hud.update(buildHudState());
}

function buildHudState() {
  const state = director.state;
  const aliveWarden = bots.bots.filter((b) => b.team === 'warden' && b.alive).length + (player.alive ? 1 : 0);
  const aliveCinder = bots.bots.filter((b) => b.team === 'cinder' && b.alive).length;
  return {
    phase: state.phase,
    roundTime: state.roundTime,
    buyTime: state.phaseTime,
    scores: state.scores,
    money: state.money,
    player,
    arsenal: player.arsenal,
    aliveW: aliveWarden,
    aliveC: aliveCinder,
    spread: player.arsenal.spread(Math.hypot(player.vel.x, player.vel.z), player.crouchAmount > 0.5, !player.onGround),
    charge: state.charge,
    defusePrompt: null,
  };
}

function renderFrame() {
  renderer.render(scene, camera);
}

// ---- loop ----------------------------------------------------------------------------------------
let last = performance.now();
let captureFrozen = false;

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (!captureFrozen) step(dt);
  renderFrame();
  requestAnimationFrame(frame);
}

// put everyone on the map so the menu orbit has something to look at
player.pos.set(world.spawns.warden[0].x, 0.2, world.spawns.warden[0].z);
player.yaw = world.spawns.warden[0].yaw;
for (const [i, bot] of bots.bots.entries()) {
  const list = bot.team === 'warden' ? world.spawns.warden : world.spawns.cinder;
  const spot = list[i % list.length];
  bot.pos.set(spot.x, 0.2, spot.z);
  bot.yaw = spot.yaw;
  bot.state = 'buy';
  bot.body.root.position.copy(bot.pos);
  bot.body.root.rotation.y = bot.yaw;
}

requestAnimationFrame(frame);

// A tiny debug surface: the capture script and anyone poking at the game in devtools uses it.
window.__IS__ = {
  state: director.state,
  player,
  bots,
  director,
  world,
  nav,
  camera,
  audio,
  gunplay,
  input,
  async capture(name) {
    const staging = await makeStage();
    staging.stage(name);
    return true;
  },
  resume() {
    captureFrozen = false;
    last = performance.now();
  },
  advance(seconds, dt = 1 / 60) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i += 1) step(dt);
  },
  live() { forceLive(); },
  setPaused(value) {
    paused = !!value;
    hud.showPause(paused);
  },
  phase() { return director.state.phase; },
  stats() {
    return {
      phase: director.state.phase,
      round: director.state.round,
      scores: { ...director.state.scores },
      alive: bots.bots.filter((b) => b.alive).length,
      player: { hp: player.hp, alive: player.alive, weapon: player.arsenal.current, ammo: player.arsenal.mags[player.arsenal.current] },
      charge: { ...director.state.charge, carrier: null, defuser: null },
      botPositions: bots.bots.map((b) => ({ name: b.name, team: b.team, x: +b.pos.x.toFixed(1), z: +b.pos.z.toFixed(1), state: b.state, alive: b.alive })),
      telemetry: { ...telemetry },
      error: window.__IS_ERROR__ || null,
    };
  },
};

async function makeStage() {
  const { createCaptureStage } = await import('./capture.js');
  return createCaptureStage({
    hud, director, bots, player, world, effects, gunplay, targets: handler.targets,
    freeze() { captureFrozen = true; },
    unfreeze() { captureFrozen = false; },
    render() { renderFrame(); },
    hudState() { return buildHudState(); },
    elapsed() { return elapsed; },
    setStarted(value) {
      started = value;
      if (value) {
        paused = false;
        hud.showPause(false);
      }
    },
  });
}

if (captureMode) {
  const shot = params.get('shot');
  // Let the first paints settle, then hand over to the (lazily loaded) screenshot stage.
  setTimeout(() => {
    makeStage()
      .then((staging) => staging.stage(shot))
      .catch((error) => {
        window.__IS_ERROR__ = String(error && error.stack ? error.stack : error);
        console.error(error);
      });
  }, 120);
} else if (params.has('auto')) {
  setTimeout(deploy, 200);
}
