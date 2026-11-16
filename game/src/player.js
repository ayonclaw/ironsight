// The player: a body with weight, a camera with recoil, and a first-person weapon built out of
// boxes. Accuracy is earned here — the cone widens with speed and with every round fired, the view
// kicks along the weapon's spray pattern, and the trigger is only true when the feet are still.

import * as THREE from 'three';
import { BODY, WEAPONS, clamp, rad } from './config.js';
import { createArsenal, recoilFor } from './combat.js';
import { groundAt, resolveCircle } from './physics.js';
import { clock } from './time.js';

const tmp = new THREE.Vector3();

// A gun you can recognise by silhouette: body, barrel, stock, magazine, sight. Built once per
// weapon and swapped on the view-model group.
function buildWeaponModel(key) {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#5d686e', roughness: 0.5, metalness: 0.3, emissive: new THREE.Color('#232c31'), emissiveIntensity: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: '#333d42', roughness: 0.62, metalness: 0.16, emissive: new THREE.Color('#161d20'), emissiveIntensity: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: '#c9a55f', roughness: 0.55, metalness: 0.3, emissive: new THREE.Color('#4d3c1a'), emissiveIntensity: 0.4 });
  const glove = new THREE.MeshStandardMaterial({ color: '#3b3128', roughness: 0.92 });
  const unit = new THREE.BoxGeometry(1, 1, 1);

  const spec = {
    p9: { len: 0.30, bodyH: 0.075, barrel: 0.05, mag: 0.11, stock: 0 },
    vesper: { len: 0.44, bodyH: 0.085, barrel: 0.11, mag: 0.15, stock: 0.12 },
    halberd: { len: 0.58, bodyH: 0.09, barrel: 0.16, mag: 0.13, stock: 0.2 },
    breakwater: { len: 0.62, bodyH: 0.1, barrel: 0.2, mag: 0.07, stock: 0.24 },
  }[key];

  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(unit, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  const L = spec.len;
  part(0.062, spec.bodyH, L * 0.46, 0, 0, -L * 0.2, steel); // receiver
  part(0.05, spec.bodyH * 0.8, L * 0.34, 0, -0.004, -L * 0.53, dark); // handguard
  part(0.026, 0.026, spec.barrel + 0.1, 0, 0.012, -L * 0.78, dark); // barrel
  part(0.04, 0.042, 0.05, 0, 0.012, -L * 0.95, steel); // muzzle
  part(0.05, 0.03, L * 0.28, 0, 0.062, -L * 0.22, accent); // optic rail
  part(0.046, 0.05, 0.07, 0, 0.088, -L * 0.26, dark); // optic body
  part(0.052, 0.05, 0.045, 0, -spec.mag * 0.62, -L * 0.24, dark); // magazine
  part(0.05, 0.09, 0.06, 0, -0.062, 0.015, dark); // grip
  if (spec.stock) part(0.048, 0.075, spec.stock, 0, -0.004, L * 0.24, dark);
  if (key === 'breakwater') part(0.04, 0.032, 0.24, 0, -0.03, -L * 0.52, dark);
  // the hand on the handguard: one block of glove is enough to sell the pose
  part(0.07, 0.075, 0.11, 0.005, -0.055, -L * 0.52, glove);
  return group;
}

export function createPlayer({ camera, scene, world, gunplay, effects, audio, rng, team = 'warden', targets, onEvent }) {
  const arsenal = createArsenal(team);
  const view = new THREE.Group();
  camera.add(view);
  const models = {};
  for (const key of Object.keys(WEAPONS)) {
    const m = buildWeaponModel(key);
    m.visible = false;
    view.add(m);
    models[key] = m;
  }
  // Sat low and angled in: the barrel runs diagonally toward the centre of the screen, which is
  // what makes a box-built view model read as a rifle rather than a grey slab.
  view.position.set(0.23, -0.21, -0.55);
  view.rotation.set(0.015, 0.2, -0.02);
  view.scale.setScalar(0.86);
  // One short-range light rides the camera: the weapon is always legible even in the shadowed
  // corners of the map, which is how first-person shooters cheat their view models into reading.
  const gunLight = new THREE.PointLight(new THREE.Color('#ffd9b0'), 4.5, 2.6, 1.4);
  gunLight.position.set(0.2, -0.05, -0.75);
  camera.add(gunLight);
  const muzzleLocal = new THREE.Vector3(0.0, 0.015, -0.42);

  const player = {
    kind: 'player',
    name: 'ROOK',
    team,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    crouch: false,
    crouchAmount: 0,
    onGround: true,
    alive: true,
    hp: 100,
    armour: 0,
    helmet: false,
    kills: 0,
    deaths: 0,
    damageDealt: 0,
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    arsenal,
    recoil: { pitch: 0, yaw: 0 },
    shake: 0,
    bob: 0,
    landDip: 0,
    fireCooldown: 0,
    aiming: false,
    adsAmount: 0,
    lastDamageAt: -99,
    lastAttacker: null,
    lastWeapon: null,
    lastShotAt: -99,
    reloadSound: 0,
    stepPhase: 0,
    fovBase: 78,
    deathAt: 0,
    viewModel: null,
  };
  player.arsenal = arsenal;

  function currentModel() {
    return models[arsenal.current] || models.p9;
  }

  function eyeHeight() {
    return BODY.eye - player.crouchAmount * (BODY.eye - BODY.crouchEye);
  }

  function eyeY() {
    return player.pos.y + eyeHeight();
  }

  player.eyeY = eyeY;

  player.reset = function reset(spawn) {
    player.pos.set(spawn.x, groundAt(world.solids, spawn.x, spawn.z, BODY.radius, 0, BODY.stepUp), spawn.z);
    player.vel.set(0, 0, 0);
    player.yaw = spawn.yaw;
    player.pitch = 0;
    player.crouch = false;
    player.crouchAmount = 0;
    player.onGround = true;
    player.alive = true;
    player.hp = 100;
    player.armour = arsenal.armour;
    player.helmet = arsenal.helmet;
    player.recoil.pitch = 0;
    player.recoil.yaw = 0;
    player.shake = 0;
    player.fireCooldown = 0;
    player.aiming = false;
    player.adsAmount = 0;
    player.lastDamageAt = -99;
    arsenal.equipBest();
    for (const key of Object.keys(models)) models[key].visible = key === arsenal.current;
  };

  // Damage lands on armour first: kevlar eats half of every body round, a helmet does the same
  // for the head, and once the vest is gone you are as soft as anyone.
  player.hit = function hit(dmg, zone, weapon, dx, dz, attacker) {
    if (!player.alive) return;
    player.lastAttacker = attacker || null;
    player.lastWeapon = weapon || null;
    let amount = dmg;
    if (player.armour > 0 && (zone !== 'head' || player.helmet)) {
      const absorbed = Math.min(player.armour, amount * 0.5);
      player.armour = Math.max(0, player.armour - absorbed);
      amount -= absorbed;
    }
    player.hp -= amount;
    player.lastDamageAt = clock.t;
    player.shake = Math.min(1.4, player.shake + 0.22 + amount * 0.006);
    onEvent({ type: 'hurt', amount, zone, dx, dz, hp: player.hp });
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      player.deaths += 1;
      player.deathAt = clock.t;
      onEvent({ type: 'died', by: weapon ? weapon.name : 'the yard' });
    }
  };

  player.look = function look(dx, dy, sensitivity) {
    if (!player.alive) return;
    const scale = 0.0022 * sensitivity * (1 - player.adsAmount * 0.45);
    player.yaw -= dx * scale;
    player.pitch -= dy * scale;
    player.pitch = clamp(player.pitch, -1.48, 1.48);
  };

  function wishSpeed(input) {
    let speed = BODY.runSpeed;
    if (input.walk) speed = BODY.walkSpeed;
    if (input.crouch) speed = BODY.crouchSpeed;
    if (player.aiming) speed *= 0.62;
    const w = arsenal.weapon();
    return speed * (w ? w.speed : 1);
  }

  player.update = function update(dt, input, canShoot) {
    const now = clock.t;
    if (!player.alive) {
      // death cam: the body stays put, the camera sinks toward the floor
      player.crouchAmount = Math.min(1, player.crouchAmount + dt * 2);
      player.pitch = Math.max(player.pitch - dt * 0.5, -0.5);
      return;
    }

    // ---- crouch, aim, movement ---------------------------------------------------------------
    player.crouch = !!input.crouch;
    player.aiming = !!input.aim;
    player.adsAmount += ((player.aiming ? 1 : 0) - player.adsAmount) * Math.min(1, dt * 12);
    player.crouchAmount += ((player.crouch ? 1 : 0) - player.crouchAmount) * Math.min(1, dt * 11);

    const speed = wishSpeed(input);
    let wx = input.moveX;
    let wz = input.moveZ;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    // collide-and-slide: accelerate, apply friction, then resolve against the map twice
    const accel = player.onGround ? BODY.accel : BODY.airAccel;
    const wishX = wx * speed;
    const wishZ = wz * speed;
    player.vel.x += (wishX - player.vel.x) * Math.min(1, accel * dt * (wl > 0.01 ? 1 : 0.6));
    player.vel.z += (wishZ - player.vel.z) * Math.min(1, accel * dt * (wl > 0.01 ? 1 : 0.6));
    if (wl < 0.01 && player.onGround) {
      const f = Math.max(0, 1 - BODY.friction * dt);
      player.vel.x *= f;
      player.vel.z *= f;
    }

    if (input.jump && player.onGround) {
      player.vel.y = BODY.jumpSpeed;
      player.onGround = false;
      audio.jump();
    }
    player.vel.y -= BODY.gravity * dt;

    player.pos.x += player.vel.x * dt;
    resolveCircle(world.solids, player.pos, BODY.radius, player.pos.y, BODY.height);
    player.pos.z += player.vel.z * dt;
    resolveCircle(world.solids, player.pos, BODY.radius, player.pos.y, BODY.height);

    // vertical: land on the highest surface under the body
    player.pos.y += player.vel.y * dt;
    const ground = groundAt(world.solids, player.pos.x, player.pos.z, BODY.radius, player.pos.y + 0.12, BODY.stepUp);
    if (player.pos.y <= ground) {
      if (!player.onGround && player.vel.y < -3.2) {
        player.landDip = Math.min(0.09, Math.abs(player.vel.y) * 0.012);
        audio.land();
        player.shake = Math.min(1, player.shake + 0.12);
      }
      player.pos.y = ground;
      player.vel.y = 0;
      player.onGround = true;
    } else if (player.pos.y > ground + 0.02) {
      player.onGround = false;
    }
    // keep the body inside the yard even if a jump finds a seam
    player.pos.x = clamp(player.pos.x, -world.bounds.x + 1.6, world.bounds.x - 1.6);
    player.pos.z = clamp(player.pos.z, -world.bounds.z + 1.6, world.bounds.z - 1.6);

    // ---- footsteps & bob --------------------------------------------------------------------
    const planar = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && planar > 0.6) {
      player.stepPhase += dt * (2.2 + planar * 0.85);
      const was = player.bob;
      player.bob = Math.sin(player.stepPhase * Math.PI) * 0.5 + 0.5;
      if (was > player.bob) audio.footstep(planar < 3.4 ? 0.5 : 1);
    } else {
      player.stepPhase += dt * 1.2;
      player.bob += (0 - player.bob) * Math.min(1, dt * 6);
    }
    player.landDip *= Math.max(0, 1 - dt * 7);

    // ---- weapon state -----------------------------------------------------------------------
    const w = arsenal.weapon();
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.recoil.pitch *= Math.max(0, 1 - (w.recoilRecover || 8) * dt * 0.55);
    player.recoil.yaw *= Math.max(0, 1 - (w.recoilRecover || 8) * dt * 0.55);
    if (now - player.lastShotAt > 0.3) {
      arsenal.shotIndex = 0;
      arsenal.spreadBloom = 0;
    } else {
      arsenal.spreadBloom = Math.max(0, arsenal.spreadBloom - w.recover * dt);
    }
    if (arsenal.reloading > 0) {
      arsenal.reloading -= dt;
      if (arsenal.reloading <= 0) {
        arsenal.finishReload();
        audio.reloadEnd();
      }
    }

    // ---- shoot ------------------------------------------------------------------------------
    const wantFire = w.auto ? input.firing : input.firePressed;
    if (wantFire && canShoot && player.fireCooldown <= 0 && arsenal.reloading <= 0) {
      player.fire();
    }
    if (input.reloadPressed) {
      if (arsenal.startReload()) audio.reloadStart();
    }
    if (input.weaponPressed) {
      const slot = input.weaponPressed;
      const want = slot === 1 ? arsenal.owned.primary : arsenal.owned.sidearm;
      if (want && arsenal.equip(want)) audio.weaponSwitch();
    }

    // ---- view ------------------------------------------------------------------------------
    player.shake = Math.max(0, player.shake - dt * 3.2);
    const bobAmt = (planar / BODY.runSpeed) * 0.022 * (player.onGround ? 1 : 0.2);
    const bobY = Math.sin(player.stepPhase * Math.PI * 2) * bobAmt;
    const bobX = Math.cos(player.stepPhase * Math.PI) * bobAmt * 0.7;
    const eye = eyeHeight();
    camera.position.set(player.pos.x + bobX * 0.5, player.pos.y + eye + bobY - player.landDip, player.pos.z);
    const kick = player.recoil.pitch;
    camera.rotation.set(
      clamp(player.pitch + rad(kick), -1.5, 1.5),
      player.yaw + rad(player.recoil.yaw),
      Math.sin(now * 14) * player.shake * 0.012,
      'YXZ',
    );
    camera.fov = player.fovBase - player.adsAmount * 20;
    camera.updateProjectionMatrix();

    // weapon in hand: lowered when moving fast, kicked by the shot, dipped on reload
    const model = currentModel();
    for (const key of Object.keys(models)) models[key].visible = key === arsenal.current;
    const moveDip = Math.min(1, planar / BODY.runSpeed) * 0.02;
    const reloadDip = arsenal.reloading > 0 ? Math.sin(Math.min(1, 1 - arsenal.reloading / w.reload) * Math.PI) * 0.14 : 0;
    const kickback = Math.max(0, player.fireCooldown > 0 ? (player.fireCooldown / (60 / w.rpm)) * 0.05 : 0);
    const ads = player.adsAmount;
    view.position.set(
      0.23 * (1 - ads) + Math.sin(player.stepPhase * Math.PI) * 0.004,
      -0.22 + moveDip + reloadDip - ads * 0.03 + Math.sin(player.stepPhase * Math.PI * 2) * 0.004,
      -0.55 + kickback + ads * 0.18,
    );
    view.rotation.set(
      0.015 + kickback * 1.6 + reloadDip * 2.2,
      0.2 * (1 - ads) + ads * 0.01,
      -0.02 + reloadDip * -1.2,
    );
    if (model) model.rotation.z = 0;
    player.viewModel = model;
  };

  // One trigger pull: consume a round, kick the view, send the trace from the muzzle.
  player.fire = function fire() {
    const w = arsenal.weapon();
    if (!arsenal.consume()) {
      if (arsenal.mags[w.key] <= 0) audio.dryFire();
      return;
    }
    player.fireCooldown = 60 / w.rpm;
    player.lastShotAt = clock.t;
    player.shotsFired += 1;
    const recoil = recoilFor(w, arsenal.shotIndex);
    arsenal.shotIndex += 1;
    player.recoil.pitch += recoil.pitch;
    player.recoil.yaw += recoil.yaw;
    player.shake = Math.min(1.4, player.shake + 0.1);
    const spread = arsenal.spread(Math.hypot(player.vel.x, player.vel.z), player.crouchAmount > 0.5, !player.onGround);
    arsenal.spreadBloom = Math.min(w.spreadMax + 1.5, arsenal.spreadBloom + w.spreadShot);

    const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation).normalize();
    const origin = camera.position.clone();
    // the round leaves the barrel, not the eyeball: the tracer starts at the muzzle tip
    view.updateWorldMatrix(true, false);
    const muzzle = view.localToWorld(tmp.set(0.01, 0.02, -0.5)).clone();

    effects.muzzle(muzzle.x, muzzle.y, muzzle.z);
    audio.shot(w.key);
    const result = gunplay.shoot({
      origin, dir, weapon: w, shooter: player, spreadDeg: spread, targets: targets(),
      tracerFrom: muzzle,
    });
    if (result.hit) {
      player.shotsHit += 1;
      if (result.zone === 'head') player.headshots += 1;
    }
    onEvent({ type: 'fired', weapon: w, spread });
  };

  player.carryOver = function carryOver(survived) {
    if (!survived) {
      arsenal.owned.primary = null;
      arsenal.armour = 0;
      arsenal.helmet = false;
      arsenal.kit = false;
    }
    arsenal.equipBest();
    arsenal.topUp();
  };

  return player;
}
