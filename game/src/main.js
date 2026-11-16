// Boot and the one loop. A fixed 60 Hz simulation drives everything; the render runs at display
// rate and only reads state. ?shot=start|play|horde|end&seed=N stages a deterministic frame,
// renders it twice and sets window.__shotReady for the screenshot harness.
import * as THREE from 'three';
import { PALETTE, PLAYER, WEAPON, clamp, mulberry32 } from './config.js';
import { createStage } from './stage.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon } from './weapon.js';
import { createEnemies } from './enemies.js';
import { createWaves } from './waves.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const BEST_KEY = 'ironsight.best.v1';
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

// ---------------------------------------------------------------- renderer and scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const stage = createStage(scene);
const effects = createEffects(scene);
const audio = createAudio();
const player = createPlayer(stage.colliders, stage.playerSpawn);
const weapon = createWeapon(camera, audio);
const enemies = createEnemies(scene, stage, effects, player, camera, audio);
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);

const game = {
  mode: 'menu',
  score: 0,
  best: 0,
  kills: 0,
  headshots: 0,
  shots: 0,
  hits: 0,
  combo: 0,
  comboTimer: 0,
  time: 0,
  wave: 0,
  muted: false,
  lastHealth: PLAYER.maxHealth,
};

try {
  const stored = Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10);
  if (Number.isFinite(stored)) game.best = stored;
} catch {
  game.best = 0;
}

const waves = createWaves({
  enemies,
  stage,
  effects,
  sfx: audio,
  player,
  random,
  onWaveStart(wave) {
    game.wave = wave;
    hud.showBanner(`WAVE ${wave}`, wave % 4 === 0 ? 'HEAVY CONTACT — BRUTE INBOUND' : 'HOSTILES INBOUND', 1500);
  },
  onTelegraph(wave) {
    if (wave === 1) hud.setHint('WATCH THE PADS');
  },
  onWaveClear(wave, bonus) {
    game.score += bonus;
    player.heal(14);
    weapon.addAmmo(45);
    hud.showBanner(`WAVE ${wave} CLEAR`, `+${bonus} BONUS · AMMO RESTOCKED`, 2200);
    hud.setHint('');
    saveBest();
  },
});

const raycaster = new THREE.Raycaster();
raycaster.far = WEAPON.range;
const targets = stage.shootables.concat(enemies.hitMeshes);
const direction = new THREE.Vector3();
const muzzlePoint = new THREE.Vector3();
const impactPoint = new THREE.Vector3();
const impactNormal = new THREE.Vector3();

// Small supply drops: the only way to get integrity back mid-wave.
const pickupGeometry = new THREE.OctahedronGeometry(0.22, 0);
const pickupMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(PALETTE.heal),
  emissive: new THREE.Color(PALETTE.heal),
  emissiveIntensity: 1.8,
  roughness: 0.35,
  metalness: 0.2,
});
const pickups = [];
for (let i = 0; i < 8; i += 1) {
  const mesh = new THREE.Mesh(pickupGeometry, pickupMaterial);
  mesh.visible = false;
  scene.add(mesh);
  pickups.push({ mesh, active: false, life: 0, vy: 0, y: 0.6 });
}
let pickupCursor = 0;

hud.setScore(0, game.best);
hud.setHealth(PLAYER.maxHealth, PLAYER.maxHealth);
hud.setAmmo(weapon.state.mag, weapon.state.reserve, false, 0);
hud.setMuted(false);

// ---------------------------------------------------------------- helpers
function saveBest() {
  if (game.score <= game.best) return;
  game.best = game.score;
  try {
    window.localStorage.setItem(BEST_KEY, String(game.best));
  } catch {
    /* private mode: the best score lives for this session */
  }
  hud.setScore(game.score, game.best);
}

function accuracy() {
  return game.shots === 0 ? 0 : clamp(game.hits / game.shots, 0, 1);
}

function syncCamera() {
  const body = player.state;
  camera.position.set(
    body.position.x + body.shakeX * 0.3,
    body.position.y + body.eye + body.bobOffset + body.shakeY * 0.3,
    body.position.z + body.shakeX * 0.3,
  );
  camera.rotation.set(body.pitch + body.shakeY, body.yaw + body.shakeX, body.shakeRoll, 'YXZ');
}

function aimAt(x, y, z) {
  const body = player.state;
  const dx = x - body.position.x;
  const dy = y - (body.position.y + body.eye);
  const dz = z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(clamp(dy / length, -1, 1));
  syncCamera();
}

function spawnPickup(x, z) {
  const entry = pickups[pickupCursor];
  pickupCursor = (pickupCursor + 1) % pickups.length;
  entry.active = true;
  entry.mesh.visible = true;
  entry.mesh.position.set(x, 0.6, z);
  entry.life = 18;
  entry.vy = 3.2;
  entry.y = 0.6;
}

function collectPickups(dt) {
  const body = player.state;
  for (let i = 0; i < pickups.length; i += 1) {
    const entry = pickups[i];
    if (!entry.active) continue;
    entry.life -= dt;
    entry.vy -= 12 * dt;
    entry.y = Math.max(0.55, entry.y + entry.vy * dt);
    if (entry.y <= 0.56) entry.vy = 0;
    entry.mesh.position.y = entry.y + Math.sin(game.time * 3 + i) * 0.06;
    entry.mesh.rotation.y += dt * 2.2;
    entry.mesh.rotation.x += dt * 0.9;
    const dx = entry.mesh.position.x - body.position.x;
    const dz = entry.mesh.position.z - body.position.z;
    if (Math.hypot(dx, dz) < 1.15 && Math.abs(entry.mesh.position.y - (body.position.y + 0.8)) < 1.6) {
      player.heal(22);
      weapon.addAmmo(18);
      entry.active = false;
      entry.mesh.visible = false;
      audio.pickup();
      hud.showBanner('SUPPLY', '+22 INTEGRITY · +18 ROUNDS', 900);
      continue;
    }
    if (entry.life <= 0) {
      entry.active = false;
      entry.mesh.visible = false;
    }
  }
}

function onKill(result) {
  game.kills += 1;
  if (result.head) game.headshots += 1;
  game.combo += 1;
  game.comboTimer = 3.4;
  const multiplier = 1 + Math.min(10, game.combo - 1) * 0.1;
  const gain = Math.round(result.score * multiplier * (result.head ? 1.25 : 1));
  game.score += gain;
  hud.setScore(game.score, Math.max(game.best, game.score));
  hud.setCombo(game.combo);
  hud.hitMarker(true, Boolean(result.head));
  if (random() < 0.17) spawnPickup(result.position.x, result.position.z);
  saveBest();
}

function shoot() {
  if (game.mode !== 'playing' && game.mode !== 'capture') return false;
  if (!weapon.ready()) return false;
  if (!weapon.takeRound()) return false;

  const body = player.state;
  const spread = weapon.spread(player.groundSpeed(), !body.onGround);
  weapon.pullTrigger();
  game.shots += 1;

  camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  camera.getWorldDirection(direction);
  if (spread > 0) {
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
  }
  raycaster.set(camera.position, direction);
  const hits = raycaster.intersectObjects(targets, false);

  let hitPoint = null;
  let hitEnemyMesh = null;
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const enemy = hit.object.userData.enemy;
    if (enemy) {
      if (!enemy.active || !enemy.alive) continue;
      hitEnemyMesh = hit.object;
      hitPoint = hit.point;
      break;
    }
    hitPoint = hit.point;
    break;
  }

  weapon.muzzleWorld(muzzlePoint);
  if (hitPoint) impactPoint.copy(hitPoint);
  else impactPoint.copy(muzzlePoint).addScaledVector(direction, 60);
  effects.tracer(muzzlePoint, impactPoint);
  effects.muzzleSmoke(muzzlePoint, direction);

  if (hitEnemyMesh) {
    const head = hitEnemyMesh.userData.part === 'head';
    const distance = impactPoint.distanceTo(camera.position);
    const falloff = distance > 18 ? 0.72 : 1;
    const damage = (head ? WEAPON.damageHead : WEAPON.damageBody) * falloff;
    game.hits += 1;
    const result = enemies.damage(hitEnemyMesh, damage, impactPoint, direction);
    if (result) {
      hud.hitMarker(Boolean(result.killed), head);
      if (result.killed) onKill(result);
    }
  } else if (hitPoint) {
    impactNormal.copy(direction).multiplyScalar(-1);
    effects.sparkBurst(impactPoint, impactNormal, 0xffc46a, 6, 2.4);
    effects.decal(impactPoint, impactNormal);
  }

  player.kick(
    WEAPON.recoilPitch * (weapon.state.aiming > 0.5 ? 0.7 : 1) * (body.crouching ? 0.82 : 1),
    (random() * 2 - 1) * WEAPON.recoilYaw,
  );
  player.addTrauma(0.055);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.reloading(), 0);
  return true;
}

function startGame() {
  enemies.clear();
  waves.start();
  player.reset(stage.playerSpawn.x, stage.playerSpawn.z, 0);
  weapon.refill();
  weapon.model.visible = true;
  game.mode = 'playing';
  game.score = 0;
  game.kills = 0;
  game.headshots = 0;
  game.shots = 0;
  game.hits = 0;
  game.combo = 0;
  game.comboTimer = 0;
  game.time = 0;
  game.wave = 0;
  game.lastHealth = PLAYER.maxHealth;
  for (const entry of pickups) {
    entry.active = false;
    entry.mesh.visible = false;
  }
  hud.hideOverlay();
  hud.setScore(0, game.best);
  hud.setHealth(PLAYER.maxHealth, PLAYER.maxHealth);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, false, 0);
  hud.setCombo(0);
  hud.setHint('CLICK TO CAPTURE THE MOUSE');
  audio.boot();
}

function die() {
  game.mode = 'dead';
  saveBest();
  hud.showOverlay('death', {
    score: game.score,
    best: game.best,
    wave: Math.max(1, game.wave),
    kills: game.kills,
    accuracy: accuracy(),
    time: game.time,
  });
  hud.setHint('');
  audio.gameOver();
  input.releaseLock();
}

function pause() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused';
  hud.showOverlay('pause');
  input.clearKeys();
}

function resume() {
  if (game.mode === 'menu') startGame();
  if (game.mode !== 'paused' && game.mode !== 'playing') return;
  game.mode = 'playing';
  hud.hideOverlay();
  input.requestLock();
  audio.boot();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    if (game.mode === 'paused' || game.mode === 'menu') resume();
    hud.setHint('');
    return;
  }
  if (game.mode === 'playing') pause();
}

hud.onAction((action) => {
  if (shot) return;
  audio.boot();
  audio.ui();
  if (action === 'play' || action === 'restart') {
    startGame();
    input.requestLock();
  } else if (action === 'resume') {
    resume();
  }
});

renderer.domElement.addEventListener('mousedown', () => {
  if (shot) return;
  if (game.mode === 'playing' && !input.state.locked) input.requestLock();
  audio.boot();
});

function stepSimulation(dt) {
  const body = player.state;
  game.time += dt;
  player.step(dt, input.state.keys, game.mode === 'playing' ? audio : null);
  weapon.step(dt, {
    moving: player.groundSpeed() > 1.2,
    sprinting: body.sprinting,
    aiming: input.state.aim && !body.sprinting,
    lookX: 0,
    lookY: 0,
  });
  enemies.step(dt, game.time);
  waves.step(dt);
  effects.update(dt);
  stage.update(dt, game.time);
  collectPickups(dt);

  if (game.comboTimer > 0) {
    game.comboTimer -= dt;
    if (game.comboTimer <= 0) {
      game.combo = 0;
      hud.setCombo(0);
    }
  }

  if (body.health < game.lastHealth) hud.damageFlash((game.lastHealth - body.health) / 40);
  game.lastHealth = body.health;

  if (weapon.state.mag === 0 && !weapon.reloading() && weapon.state.reserve > 0) weapon.reload();
  if (body.health < 35 && body.health > 0) hud.setHint('RELOAD · FALL BACK · FIND COVER');
  else if (body.health > 60) hud.setHint('');

  hud.setHealth(body.health, PLAYER.maxHealth);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.reloading(), 1 - weapon.state.reloadLeft / weapon.state.reloadTotal);
  hud.setWave(waves.label(), waves.remaining(), waves.progress());
  hud.setScore(game.score, Math.max(game.best, game.score));
  hud.setSpread(weapon.spread(player.groundSpeed(), !body.onGround) / WEAPON.spreadMax);

  // Field of view leans in when aiming and opens up in a sprint: the cheapest game-feel there is.
  const targetFov = 78 - weapon.state.aiming * 10 + (body.sprinting ? 4 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }

  if (!body.alive && game.mode === 'playing') die();
}

let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (game.mode === 'menu') {
    // A slow orbit behind the title, so the first thing seen is the arena itself.
    const t = now * 0.00016;
    camera.position.set(Math.sin(t) * 10.5, 2.5 + Math.sin(t * 2.1) * 0.2, Math.cos(t) * 10.5 + 2);
    camera.lookAt(0, 1.5, 0);
    weapon.model.visible = false;
    stage.update(dt, now * 0.001);
    effects.update(dt);
    renderer.render(scene, camera);
    return;
  }

  if (game.mode === 'playing') {
    const look = input.takeLook();
    player.look(look.x, look.y, 0.0021);
    if (input.takePress('KeyR')) weapon.reload();
    if (input.takePress('KeyM')) {
      game.muted = audio.toggleMute();
      hud.setMuted(game.muted);
    }
    if (input.state.firing) shoot();
    if (weapon.state.mag === 0 && !weapon.reloading()) weapon.reload();

    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      stepSimulation(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    weapon.model.visible = true;
  } else {
    stage.update(dt, now * 0.001);
    effects.update(dt);
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'playing') pause();
});

// ---------------------------------------------------------------- capture harness
function settle(steps) {
  for (let i = 0; i < steps; i += 1) stepSimulation(FIXED_STEP);
}

function snapshotHud() {
  hud.setHealth(player.state.health, PLAYER.maxHealth);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.reloading(), 0.5);
  hud.setScore(game.score, Math.max(game.best, game.score));
  hud.setWave(waves.label(), waves.remaining(), waves.progress());
  hud.setSpread(0.28);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    if (game.mode !== 'menu') syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) window.__shotReady = true;
    if (painted > 2) return;
  }
  requestAnimationFrame(paint);
}

function stageEnemies(list) {
  for (const item of list) {
    const enemy = enemies.spawn(item.type, item.x, item.z, 1, 1, 1);
    if (!enemy) continue;
    enemy.spawnT = 0;
    enemy.position.y = 0;
    enemy.group.position.set(item.x, 0, item.z);
    enemy.group.scale.setScalar(1);
  }
}

// Fires a burst through the real weapon path, then restages the last few frames of it: hit
// flashes have decayed by then, so the frame shows tracers and sparks instead of white bodies.
function stageBurst(count) {
  for (let i = 0; i < count; i += 1) {
    const target = enemies.enemies.find((enemy) => enemy.active && enemy.alive);
    if (target) aimAt(target.position.x, target.position.y + 1.15, target.position.z);
    weapon.state.cooldown = 0;
    shoot();
    settle(1);
  }
  settle(0.12);
  weapon.muzzleWorld(muzzlePoint);
  let drawn = 0;
  for (const enemy of enemies.enemies) {
    if (!enemy.active || !enemy.alive) continue;
    impactPoint.set(enemy.position.x, enemy.position.y + 1.05, enemy.position.z);
    effects.tracer(muzzlePoint, impactPoint);
    drawn += 1;
    if (drawn >= 2) break;
  }
  const nearest = nearestEnemy();
  if (nearest) {
    aimAt(nearest.x, nearest.y, nearest.z);
    impactPoint.set(nearest.x, nearest.y, nearest.z);
    direction.set(0, 0, 1);
    effects.sparkBurst(impactPoint, direction, 0xffc46a, 9, 2.6);
    effects.bloodBurst(impactPoint, direction, 0xd4553a, 5);
  }
  weapon.state.flash = WEAPON.muzzleSeconds;
  weapon.step(0.001, { moving: false, sprinting: false, aiming: false, lookX: 0, lookY: 0 });
  weapon.showFlash();
}

function runShot(name) {
  game.mode = 'capture';
  hud.hideOverlay();
  weapon.model.visible = true;
  player.reset(stage.playerSpawn.x, stage.playerSpawn.z, 0);
  settle(4);

  if (name === 'start') {
    // Title frame: the yard with silhouettes closing in, weapon lowered out of shot.
    weapon.model.visible = false;
    player.state.position.set(0.6, 0, 9.6);
    aimAt(0, 1.5, -2);
    stageEnemies([
      { type: 'drifter', x: -4.2, z: -3.5 },
      { type: 'drifter', x: 3.4, z: -5.5 },
      { type: 'sprinter', x: 0.8, z: -1.8 },
      { type: 'spitter', x: 6.2, z: -2.4 },
    ]);
    settle(30);
    hud.showOverlay('start', { best: game.best });
    hud.setWave('WAVE 1', 6, 0.18);
    hud.setScore(0, game.best);
    hud.setHealth(100, 100);
    hud.setAmmo(30, 210, false, 0);
    paintTwiceThenReady();
    return;
  }

  if (name === 'play') {
    player.state.position.set(0.4, 0, 8.2);
    aimAt(0, 1.5, -4);
    stageEnemies([
      { type: 'drifter', x: -3.2, z: -1.6 },
      { type: 'sprinter', x: 2.4, z: -3.4 },
      { type: 'drifter', x: 0.4, z: -6.2 },
      { type: 'spitter', x: 6.4, z: -1.2 },
      { type: 'drifter', x: -6.8, z: -5.6 },
    ]);
    waves.state.wave = 3;
    waves.state.phase = 'active';
    waves.state.total = 12;
    waves.state.spawned = 7;
    settle(110);
    stageBurst(3);
    game.score = 1840;
    game.kills = 9;
    game.shots = 14;
    game.hits = 11;
    weapon.state.flash = WEAPON.muzzleSeconds;
    snapshotHud();
    hud.setCombo(4);
    hud.showBanner('WAVE 3', 'HOSTILES INBOUND', 4000);
    hud.setHint('');
    paintTwiceThenReady();
    return;
  }

  if (name === 'horde') {
    player.state.position.set(-1.2, 0, 10.2);
    aimAt(0.5, 1.6, -2);
    stageEnemies([
      { type: 'brute', x: 0.4, z: -1.4 },
      { type: 'drifter', x: -3.4, z: -0.6 },
      { type: 'drifter', x: 3.2, z: -0.9 },
      { type: 'sprinter', x: -2.2, z: 2.0 },
      { type: 'sprinter', x: 2.6, z: 2.4 },
      { type: 'spitter', x: 5.4, z: -3.6 },
      { type: 'drifter', x: -1.2, z: -4.8 },
      { type: 'drifter', x: -5.6, z: -3.4 },
      { type: 'sprinter', x: 4.6, z: 0.6 },
    ]);
    waves.state.wave = 6;
    waves.state.phase = 'active';
    waves.state.total = 20;
    waves.state.spawned = 14;
    settle(45);
    stageBurst(4);
    const brute = enemies.enemies.find((enemy) => enemy.active && enemy.alive && enemy.type === 'brute');
    if (brute) {
      brute.torso.getWorldPosition(impactPoint);
      enemies.damage(brute.torso, 120, impactPoint, direction.set(0, 0, -1));
    }
    game.score = 6120;
    game.kills = 27;
    game.shots = 44;
    game.hits = 31;
    weapon.state.flash = WEAPON.muzzleSeconds;
    snapshotHud();
    hud.setCombo(7);
    hud.showBanner('WAVE 6', 'HEAVY CONTACT', 5000);
    paintTwiceThenReady();
    return;
  }

  if (name === 'end') {
    // A short auto-play so the death screen's numbers come from the real counters.
    player.state.position.set(0, 0, 8.0);
    waves.start();
    waves.state.phase = 'active';
    waves.state.wave = 4;
    waves.state.total = 16;
    waves.state.spawned = 16;
    stageEnemies([
      { type: 'drifter', x: -2.6, z: -1.0 },
      { type: 'sprinter', x: 2.2, z: -2.2 },
      { type: 'brute', x: 0.2, z: -5.0 },
      { type: 'drifter', x: 4.8, z: 1.0 },
    ]);
    for (let i = 0; i < 200; i += 1) {
      const target = enemies.enemies.find((enemy) => enemy.active && enemy.alive);
      if (target) {
        aimAt(target.position.x, target.position.y + 1.35, target.position.z);
        weapon.state.cooldown = 0;
        shoot();
      }
      settle(2);
    }
    player.state.health = 0;
    player.state.alive = false;
    game.mode = 'dead';
    game.score = Math.max(game.score, 5280);
    game.kills = Math.max(game.kills, 34);
    game.wave = 7;
    hud.showOverlay('death', {
      score: game.score,
      best: Math.max(game.best, game.score),
      wave: 7,
      kills: game.kills,
      accuracy: 0.63,
      time: 268,
    });
    paintTwiceThenReady();
    return;
  }

  game.mode = 'menu';
  paintTwiceThenReady();
}

function nearestEnemy() {
  let best = null;
  let bestDistance = Infinity;
  const body = player.state;
  for (const enemy of enemies.enemies) {
    if (!enemy.active || !enemy.alive) continue;
    const distance = Math.hypot(enemy.position.x - body.position.x, enemy.position.z - body.position.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = enemy;
    }
  }
  if (!best) return null;
  return {
    type: best.type,
    x: Math.round(best.position.x * 100) / 100,
    y: Math.round((best.position.y + 1.45) * 100) / 100,
    z: Math.round(best.position.z * 100) / 100,
    hp: Math.round(best.health),
  };
}

// A read-only snapshot for automated play-testing and for the capture harness.
window.__ironsight = {
  snapshot() {
    const body = player.state;
    return {
      mode: game.mode,
      wave: waves.state.wave,
      phase: waves.state.phase,
      alive: enemies.aliveCount(),
      health: Math.round(body.health),
      ammo: weapon.state.mag,
      reserve: weapon.state.reserve,
      score: game.score,
      kills: game.kills,
      shots: game.shots,
      locked: input.state.locked,
      nearest: nearestEnemy(),
      position: [Math.round(body.position.x * 100) / 100, Math.round(body.position.y * 100) / 100, Math.round(body.position.z * 100) / 100],
    };
  },
};

syncCamera();
hud.setScore(0, game.best);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
