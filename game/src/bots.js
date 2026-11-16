// Bots. They are not aimbots: they see through a field of view with a line-of-sight test, react
// after a human-ish delay, walk a navigation path to a lane or a hold, and shoot inside a cone
// that starts wide and settles. The skill is in where they stand and when they commit.
//
// Every bot shares the player's collision, its own armour/loadout and the same ballistics, so a
// bot that catches you in the open kills you for the same reasons a person would.

import * as THREE from 'three';
import { BOT, WEAPONS, GEAR, MATCH, clamp, rad, randRange } from './config.js';
import { createArsenal } from './combat.js';
import { groundAt, resolveCircle, lineClear } from './physics.js';
import { clock } from './time.js';

const NAMES = {
  warden: ['VOSS', 'KANE', 'MERCER', 'HALE', 'ODA', 'BRIGGS', 'TAL', 'WREN'],
  cinder: ['SKARN', 'DRAKE', 'VEX', 'MOLT', 'GRIT', 'ASH', 'KEST', 'RUIN'],
};

const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

// A low-poly body: boots, fatigues, a plate carrier in team colour, a helmet and a rifle. Every
// part is a scaled box off one geometry, so ten of them cost almost nothing.
function buildBody(team, accent) {
  const root = new THREE.Group();
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const cloth = new THREE.MeshStandardMaterial({ color: team === 'warden' ? '#2f3a40' : '#3d3128', roughness: 0.92 });
  const plate = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.72, metalness: 0.18 });
  const skin = new THREE.MeshStandardMaterial({ color: '#8d6a52', roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: '#3c464b', roughness: 0.55, metalness: 0.3 });
  const visor = new THREE.MeshStandardMaterial({ color: '#0e1416', emissive: new THREE.Color(accent), emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.6 });

  function part(parent, w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(unit, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  const hips = new THREE.Group();
  hips.position.y = 0.86;
  root.add(hips);

  part(hips, 0.34, 0.24, 0.22, 0, 0.02, 0, cloth); // pelvis
  const torso = part(hips, 0.46, 0.52, 0.26, 0, 0.34, 0, cloth);
  part(hips, 0.48, 0.34, 0.29, 0, 0.36, 0, plate); // carrier
  part(hips, 0.16, 0.1, 0.03, 0.12, 0.44, 0.15, steel); // pouch
  part(hips, 0.12, 0.12, 0.03, -0.14, 0.4, 0.15, steel);

  const neck = part(hips, 0.11, 0.09, 0.11, 0, 0.62, 0, skin);
  const head = new THREE.Group();
  head.position.set(0, 0.72, 0);
  hips.add(head);
  part(head, 0.22, 0.24, 0.23, 0, 0.06, 0, skin);
  part(head, 0.25, 0.12, 0.26, 0, 0.16, 0, plate); // helmet shell
  part(head, 0.19, 0.06, 0.02, 0, 0.08, 0.12, visor); // visor band

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.28, 0.52, 0);
    hips.add(shoulder);
    part(shoulder, 0.11, 0.34, 0.12, 0, -0.16, 0, cloth);
    part(shoulder, 0.1, 0.22, 0.1, 0, -0.4, 0.02, skin);
    arms.push(shoulder);
  }
  // the rifle, held across the chest
  const rifle = new THREE.Group();
  rifle.position.set(0.2, 0.36, 0.16);
  hips.add(rifle);
  part(rifle, 0.05, 0.07, 0.5, 0, 0, -0.1, steel);
  part(rifle, 0.03, 0.03, 0.18, 0, 0.01, -0.38, steel);
  part(rifle, 0.04, 0.1, 0.06, 0, -0.07, -0.02, steel);

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0, 0);
    root.add(hip);
    part(hip, 0.15, 0.5, 0.17, 0, -0.26, 0, cloth);
    part(hip, 0.13, 0.42, 0.15, 0, -0.68, 0, cloth);
    part(hip, 0.15, 0.1, 0.24, 0, -0.9, 0.04, steel); // boot
    legs.push(hip);
  }

  const charge = new THREE.Group();
  charge.position.set(0, 0.42, -0.2);
  hips.add(charge);
  const pack = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ color: '#3a2f22', roughness: 0.8 }));
  pack.scale.set(0.3, 0.28, 0.16);
  charge.add(pack);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff7a42', emissive: new THREE.Color('#ff7a42'), emissiveIntensity: 2 }));
  led.position.set(0, 0.08, -0.1);
  charge.add(led);
  charge.visible = false;

  // Only the big shapes cast shadows: ten bots' pouches and rifle furniture in the shadow pass
  // cost more than they add.
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = o.scale.x * o.scale.y * o.scale.z > 0.006;
  });
  return { root, hips, head, arms, legs, rifle, charge, led };
}

export function createBots({ scene, world, nav, gunplay, effects, audio, rng, config, targets, onEvent }) {
  const bots = [];
  const teamColors = { warden: config.warden, cinder: config.cinder };
  let nextId = 1;

  function spawn(team, index, spawnPoint, role) {
    const name = NAMES[team][index % NAMES[team].length];
    const body = buildBody(team, teamColors[team]);
    scene.add(body.root);
    // Defenders start with the angle and the read; attackers have to earn it, so the sides
    // get different hands rather than the same bot wearing two shirts.
    const skill = team === 'warden' ? 0.76 + rng() * 0.2 : 0.6 + rng() * 0.2;
    const bot = {
      kind: 'bot',
      id: nextId++,
      name,
      team,
      role, // 'sapper' | 'entry' | 'anchor' | 'rotator'
      body,
      pos: new THREE.Vector3(spawnPoint.x, 0, spawnPoint.z),
      vel: new THREE.Vector3(),
      yaw: spawnPoint.yaw,
      pitch: 0,
      crouch: false,
      alive: true,
      hp: 100,
      armour: 0,
      helmet: false,
      money: 800,
      arsenal: createArsenal(team),
      kills: 0,
      deaths: 0,
      skill,
      // AI state
      state: 'advance',
      target: null,
      lastSeen: null,
      lastSeenAt: -99,
      seenAt: 0,
      reaction: 0,
      aimError: 0,
      path: [],
      pathIndex: 0,
      repathAt: 0,
      thinkAt: 0,
      holdPoint: null,
      holdScan: rng() * Math.PI * 2,
      burstLeft: 0,
      burstPause: 0,
      fireCooldown: 0,
      shotIndex: 0,
      spreadBloom: 0,
      strafe: 0,
      strafeUntil: 0,
      action: null, // 'plant' | 'defuse'
      actionProgress: 0,
      lastHurtAt: -99,
      stepPhase: rng() * 10,
      deathAt: 0,
      fall: 0,
      crouchAmount: 0,
      spawnIndex: bots.filter((b) => b.team === team).length,
    };
    bot.arsenal.team = team;
    // same interface the player exposes, so ballistics does not care who it hit
    bot.hit = (dmg, zone, weapon, dx, dz, attacker) => hit(bot, dmg, zone, weapon, dx, dz, attacker);
    bot.pos.y = groundAt(world.solids, bot.pos.x, bot.pos.z, BOT.radius, 0, 0.5);
    bot.body.root.position.copy(bot.pos);
    bot.body.root.rotation.y = bot.yaw;
    bots.push(bot);
    return bot;
  }

  function eyeOf(bot) {
    return bot.pos.y + (bot.crouch ? 1.1 : 1.62);
  }

  // ---- perception ---------------------------------------------------------------------------
  function visibleEnemy(bot, actors, maxDist) {
    const eye = eyeOf(bot);
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < actors.length; i += 1) {
      const other = actors[i];
      if (!other.alive || other.team === bot.team) continue;
      const dx = other.pos.x - bot.pos.x;
      const dz = other.pos.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > maxDist) continue;
      // in the field of view? (bot can be turned toward a sound, which is why this is generous)
      const angle = Math.atan2(-dx, -dz);
      let delta = angle - bot.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > rad(BOT.fov / 2)) continue;
      const ty = other.pos.y + (other.crouch ? 1.0 : 1.5);
      if (!lineClear(world.solids, bot.pos.x, eye, bot.pos.z, other.pos.x, ty, other.pos.z)) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = other;
      }
    }
    return best;
  }

  // ---- damage -------------------------------------------------------------------------------
  function hit(bot, dmg, zone, weapon, dx, dz, attacker) {
    if (!bot.alive) return;
    let amount = dmg;
    if (bot.armour > 0 && (zone !== 'head' || bot.helmet)) {
      const absorbed = Math.min(bot.armour, amount * 0.5);
      bot.armour = Math.max(0, bot.armour - absorbed);
      amount -= absorbed;
    }
    bot.hp -= amount;
    bot.lastHurtAt = clock.t;
    // being shot at turns a bot toward the shooter, and interrupts an objective action
    if (attacker && attacker.alive) {
      const ax = attacker.pos.x - bot.pos.x;
      const az = attacker.pos.z - bot.pos.z;
      if (Math.hypot(ax, az) < 38) {
        bot.lastSeen = { x: attacker.pos.x, z: attacker.pos.z };
        bot.lastSeenAt = clock.t;
        if (bot.state === 'hold') { bot.state = 'engage'; bot.target = attacker; }
      }
    }
    if (bot.action) {
      bot.action = null;
      bot.actionProgress = Math.max(0, bot.actionProgress - 0.25);
    }
    onEvent({ type: 'botHurt', bot, amount, zone });
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.deaths += 1;
      bot.deathAt = clock.t;
      bot.state = 'dead';
      bot.target = null;
      effects.death(bot.pos.x, bot.pos.y + 0.9, bot.pos.z);
      onEvent({ type: 'botDied', bot, weapon, zone, attacker });
    }
  }

  // ---- loadout ------------------------------------------------------------------------------
  function buyPhase(bot) {
    const a = bot.arsenal;
    a.reset();
    bot.money = clamp(bot.money, 0, 16000);
    const price = (key) => (WEAPONS[key] || GEAR[key]).price;
    if (bot.money >= 2700) {
      bot.money -= price('halberd');
      a.buy('halberd');
    } else if (bot.money >= 1250) {
      const pick = rng() < 0.72 ? 'vesper' : 'breakwater';
      bot.money -= price(pick);
      a.buy(pick);
    }
    if (bot.money >= 1000 && rng() < 0.72) {
      bot.money -= price('vest');
      a.buyGear('vest');
      if (bot.money >= 350 && rng() < 0.5) { bot.money -= 350; a.buyGear('helmet'); }
    } else if (bot.money >= 650) {
      bot.money -= price('vest');
      a.buyGear('vest');
    }
    if (bot.team === 'warden' && bot.money >= 400 && !a.kit) {
      bot.money -= 400;
      a.buyGear('kit');
    }
    a.equipBest();
    a.topUp();
  }

  // ---- movement -----------------------------------------------------------------------------
  function followPath(bot, dt, speed, stopDist = 0.7) {
    if (!bot.path || bot.path.length === 0) return false;
    let node = bot.path[bot.pathIndex];
    while (node) {
      const dx = node.x - bot.pos.x;
      const dz = node.z - bot.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < stopDist) {
        bot.pathIndex += 1;
        node = bot.path[bot.pathIndex];
        continue;
      }
      const wishX = (dx / d) * speed;
      const wishZ = (dz / d) * speed;
      const accel = Math.min(1, 12 * dt);
      bot.vel.x += (wishX - bot.vel.x) * accel;
      bot.vel.z += (wishZ - bot.vel.z) * accel;
      bot.wished = true;
      return true;
    }
    bot.vel.x *= Math.max(0, 1 - dt * 8);
    bot.vel.z *= Math.max(0, 1 - dt * 8);
    return false;
  }

  function moveBody(bot, dt) {
    // Feet on the ground: no wish direction means friction, and nobody outruns a sprint.
    if (!bot.wished) {
      const damp = Math.max(0, 1 - 9 * dt);
      bot.vel.x *= damp;
      bot.vel.z *= damp;
    }
    const speed = Math.hypot(bot.vel.x, bot.vel.z);
    const cap = 5.7;
    if (speed > cap) {
      bot.vel.x = (bot.vel.x / speed) * cap;
      bot.vel.z = (bot.vel.z / speed) * cap;
    }
    bot.pos.x += bot.vel.x * dt;
    resolveCircle(world.solids, bot.pos, BOT.radius, bot.pos.y, BOT.height);
    bot.pos.z += bot.vel.z * dt;
    resolveCircle(world.solids, bot.pos, BOT.radius, bot.pos.y, BOT.height);
    bot.pos.y = groundAt(world.solids, bot.pos.x, bot.pos.z, BOT.radius, bot.pos.y + 0.3, 0.5);
    bot.pos.x = clamp(bot.pos.x, -world.bounds.x + 1.6, world.bounds.x - 1.6);
    bot.pos.z = clamp(bot.pos.z, -world.bounds.z + 1.6, world.bounds.z - 1.6);
    bot.pos.y = groundAt(world.solids, bot.pos.x, bot.pos.z, BOT.radius, bot.pos.y + 0.05, 0.5);
  }

  function faceToward(bot, x, z, dt, rate = 8) {
    const targetYaw = Math.atan2(-(x - bot.pos.x), -(z - bot.pos.z));
    let delta = targetYaw - bot.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    bot.yaw += delta * Math.min(1, rate * dt);
    if (bot.yaw > Math.PI) bot.yaw -= Math.PI * 2;
    else if (bot.yaw < -Math.PI) bot.yaw += Math.PI * 2;
  }

  function faceAngle(bot, yaw, dt, rate = 5) {
    let delta = yaw - bot.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    bot.yaw += delta * Math.min(1, rate * dt);
    if (bot.yaw > Math.PI) bot.yaw -= Math.PI * 2;
    else if (bot.yaw < -Math.PI) bot.yaw += Math.PI * 2;
  }

  function setPath(bot, x, z) {
    bot.path = nav.path(bot.pos.x, bot.pos.z, x, z);
    bot.pathIndex = 0;
  }

  // ---- shooting -----------------------------------------------------------------------------
  function shootAt(bot, target, dt, now) {
    const w = bot.arsenal.weapon();
    if (!w || bot.arsenal.reloading > 0) return;
    if (bot.fireCooldown > 0) return;
    if (bot.burstLeft <= 0) return;
    if (bot.arsenal.mags[w.key] <= 0) {
      bot.arsenal.startReload();
      return;
    }
    // aim: the yaw/pitch already carries the aim error; add a touch of vertical lead
    const dist = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
    const spread = w.spread + 0.4 + Math.max(0, 6 - dist) * 0.05;
    const origin = tmpVec.set(bot.pos.x, bot.pos.y + (bot.crouch ? 1.1 : 1.48), bot.pos.z);
    const dx = target.pos.x - origin.x;
    const dy = (target.pos.y + (target.crouch ? 1.0 : 1.42) - origin.y);
    const dz = target.pos.z - origin.z;
    const aimYaw = bot.yaw - rad(bot.aimError * (rng() - 0.5) * 2);
    const horizontal = Math.hypot(dx, dz);
    const aimPitch = Math.atan2(dy, horizontal) - rad(bot.aimError * (rng() - 0.5) * 1.2);
    const dir = tmpVec2.set(
      -Math.sin(aimYaw) * Math.cos(aimPitch),
      Math.sin(aimPitch),
      -Math.cos(aimYaw) * Math.cos(aimPitch),
    ).normalize();

    bot.arsenal.mags[w.key] -= 1;
    bot.fireCooldown = 60 / w.rpm;
    bot.burstLeft -= 1;
    bot.arsenal.spreadBloom = Math.min(w.spreadMax, bot.arsenal.spreadBloom + w.spreadShot);
    bot.body.rifle.position.z = 0.13; // recoil nudge on the model
    onEvent({ type: 'botShot', bot, weapon: w });
    gunplay.shoot({
      origin: origin.clone(), dir, weapon: w, shooter: bot, spreadDeg: spread,
      targets: targets(), tracerFrom: origin,
    });
  }

  function engage(bot, target, dt, now, ctx) {
    const w = bot.arsenal.weapon();
    const dist = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
    // aim error settles the longer the bot keeps eyes on the target
    const settle = (now - bot.seenAt) / BOT.settle;
    const floor = BOT.aimFloor[0] + (1 - bot.skill) * BOT.aimFloor[1];
    const start = BOT.aimError[0] + (1 - bot.skill) * BOT.aimError[1];
    bot.aimError = floor + Math.max(0, start - floor) * Math.exp(-settle * 2.2) * (0.55 + dist * 0.02);

    // turn onto the target, leading a little when it is moving fast
    const lead = 0.08;
    const tx = target.pos.x + (target.vel ? target.vel.x * lead : 0);
    const tz = target.pos.z + (target.vel ? target.vel.z * lead : 0);
    faceToward(bot, tx, tz, dt, 6 + bot.skill * 8);
    const eye = eyeOf(bot);
    const aimY = target.pos.y + (target.crouch ? 1.05 : 1.45);
    const wantPitch = Math.atan2(aimY - eye, Math.hypot(tx - bot.pos.x, tz - bot.pos.z));
    bot.pitch += (wantPitch - bot.pitch) * Math.min(1, dt * 10);

    // reaction delay once, then bursts with pauses
    if (bot.reaction > 0) {
      bot.reaction -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstPause -= dt;
      if (bot.burstPause <= 0) {
        bot.burstLeft = Math.round(randRange(rng, BOT.burst) * (0.6 + bot.skill * 0.6));
        bot.burstPause = randRange(rng, BOT.burstPause);
      }
      return;
    }
    shootAt(bot, target, dt, now);

    // A duel at range is not a ceasefire: keep closing on the objective while trading shots,
    // which is what turns a long lane into a site take instead of a stalemate.
    const goal = ctx.goalFor(bot);
    const goalDist = Math.hypot(goal.x - bot.pos.x, goal.z - bot.pos.z);
    if (goalDist > 3.2 && dist > 10) {
      if (now > bot.repathAt) {
        bot.repathAt = now + 1.4;
        setPath(bot, goal.x, goal.z);
      }
      followPath(bot, dt, bot.role === 'sapper' ? 4.2 : 3.3);
    }

    // strafe while firing, so a duel is not two statues
    if (now > bot.strafeUntil && rng() < BOT.strafeChance * dt * 6) {
      bot.strafe = rng() < 0.5 ? -1 : 1;
      bot.strafeUntil = now + 0.4 + rng() * 0.6;
    }
    if (now < bot.strafeUntil && dist > 4) {
      const perpendicular = bot.yaw + Math.PI / 2;
      const sx = -Math.sin(perpendicular) * bot.strafe;
      const sz = -Math.cos(perpendicular) * bot.strafe;
      bot.vel.x += sx * 26 * dt;
      bot.vel.z += sz * 26 * dt;
      bot.wished = true;
    }
    if (w) bot.spreadBloom = Math.max(0, bot.arsenal.spreadBloom - w.recover * dt);
    bot.arsenal.reloading = Math.max(0, bot.arsenal.reloading - dt);
  }

  // ---- the round plan -----------------------------------------------------------------------
  function assignRound(plan) {
    for (const bot of bots) {
      const list = plan.spawns[bot.team];
      const spawn = list[bot.spawnIndex % list.length];
      bot.pos.set(spawn.x, 0, spawn.z);
      bot.pos.y = groundAt(world.solids, spawn.x, spawn.z, BOT.radius, 0, 0.5);
      bot.yaw = spawn.yaw;
      bot.pitch = 0;
      bot.alive = true;
      bot.hp = 100;
      bot.target = null;
      bot.lastSeen = null;
      bot.lastSeenAt = -99;
      bot.action = null;
      bot.actionProgress = 0;
      bot.path = [];
      bot.pathIndex = 0;
      bot.vel.set(0, 0, 0);
      bot.crouch = false;
      bot.crouchAmount = 0;
      bot.state = plan.phase === 'buy' ? 'buy' : 'advance';
      bot.armour = bot.arsenal.armour;
      bot.helmet = bot.arsenal.helmet;
      bot.body.root.rotation.set(0, spawn.yaw, 0);
      bot.body.root.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
      bot.body.root.scale.y = 1;
      bot.body.charge.visible = bot.role === 'sapper';
      bot.reaction = 0;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.fireCooldown = 0;
      bot.repathAt = clock.t + rng() * 0.4;
      bot.arsenal.equipBest();
      bot.holdLook = spawn.yaw;
      const goal = plan.goal(bot);
      if (goal) setPath(bot, goal.x, goal.z);
    }
  }

  // ---- per-frame ----------------------------------------------------------------------------
  function update(dt, ctx) {
    const now = clock.t;

    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      const body = bot.body;
      bot.wished = false;
      bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);

      if (!bot.alive) {
        // fall over, then stay down
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt * 3.2);
          body.root.rotation.x = -bot.fall * (Math.PI / 2) * 0.92;
          body.root.position.y = bot.pos.y - bot.fall * 0.06;
        }
        continue;
      }

      // ---- perception ----
      if (now >= bot.thinkAt) {
        bot.thinkAt = now + BOT.think;
        const seen = visibleEnemy(bot, ctx.actors, BOT.viewRange);
        if (seen) {
          if (bot.target !== seen) {
            bot.target = seen;
            bot.seenAt = now;
            // A bot already holding the angle has its rifle up: less to do when a body appears.
            const held = bot.state === 'hold' ? 0.62 : 1;
            bot.reaction = randRange(rng, BOT.reaction) * (1.25 - bot.skill * 0.45) * held;
            bot.burstLeft = 0;
            bot.burstPause = 0.05;
          }
          bot.lastSeen = { x: seen.pos.x, z: seen.pos.z };
          bot.lastSeenAt = now;
          if (bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') bot.state = 'engage';
        } else if (bot.target && now - bot.lastSeenAt > 0.45) {
          bot.target = null;
          if (bot.state === 'engage') bot.state = bot.lastSeen ? 'hunt' : 'advance';
        }
      }

      // ---- objective actions ----
      if (bot.action === 'plant') {
        if (ctx.charge.planted) { bot.action = null; bot.actionProgress = 0; }
        else {
          bot.actionProgress += dt / MATCH.plantTime;
          bot.vel.x *= 0.2; bot.vel.z *= 0.2;
          faceAngle(bot, Math.atan2(-(ctx.plantSpot.x - bot.pos.x), -(ctx.plantSpot.z - bot.pos.z)), dt, 6);
          if (bot.actionProgress >= 1) {
            bot.action = null;
            bot.actionProgress = 0;
            ctx.onPlant(bot);
            bot.state = 'hold';
            bot.holdPoint = { x: ctx.plantSpot.x + (rng() - 0.5) * 6, z: ctx.plantSpot.z + (rng() - 0.5) * 6 };
            setPath(bot, bot.holdPoint.x, bot.holdPoint.z);
          }
        }
        if (bot.action === 'plant') { animate(bot, dt, now); continue; }
      }
      if (bot.action === 'defuse') {
        if (!ctx.charge.planted || ctx.charge.defused || ctx.charge.detonated) { bot.action = null; bot.actionProgress = 0; }
        else {
          const time = bot.arsenal.kit ? MATCH.defuseKitTime : MATCH.defuseTime;
          bot.actionProgress += dt / time;
          // the HUD's objective bar shows the best progress anyone has on the charge
          ctx.charge.defuseProgress = Math.max(ctx.charge.defuseProgress, bot.actionProgress);
          bot.vel.x *= 0.2; bot.vel.z *= 0.2;
          bot.crouch = true;
          if (bot.actionProgress >= 1) {
            bot.action = null;
            bot.actionProgress = 0;
            ctx.onDefuse(bot);
          }
        }
        if (bot.action === 'defuse') { animate(bot, dt, now); continue; }
      }

      // ---- state machine ----
      switch (bot.state) {
        case 'buy': {
          // hold at spawn, face the site
          bot.vel.x *= 0.8; bot.vel.z *= 0.8;
          faceToward(bot, 0, 0, dt, 2);
          break;
        }
        case 'advance': {
          const goal = ctx.goalFor(bot);
          const arrived = Math.hypot(bot.pos.x - goal.x, bot.pos.z - goal.z) < 1.6;
          if (arrived) {
            bot.state = 'hold';
            bot.holdPoint = { x: goal.x, z: goal.z };
            bot.holdLook = goal.lookX !== undefined
              ? Math.atan2(-(goal.lookX - goal.x), -(goal.lookZ - goal.z))
              : Math.atan2(-(0 - goal.x), -(0 - goal.z));
            bot.holdScan = rng() * Math.PI * 2;
            break;
          }
          if (now > bot.repathAt) {
            bot.repathAt = now + 1.1 + rng() * 0.6;
            if (bot.path.length === 0 || bot.pathIndex >= bot.path.length) setPath(bot, goal.x, goal.z);
          }
          const sprint = bot.role === 'sapper' || bot.role === 'entry';
          followPath(bot, dt, (sprint ? 5.2 : 4.6) * (0.85 + bot.skill * 0.2));
          faceToward(bot, bot.pos.x + bot.vel.x, bot.pos.z + bot.vel.z, dt, 5);
          break;
        }
        case 'hunt': {
          if (now > bot.repathAt && bot.lastSeen) {
            bot.repathAt = now + 1.4;
            setPath(bot, bot.lastSeen.x, bot.lastSeen.z);
          }
          const moving = followPath(bot, dt, 4.4);
          if (!moving) {
            bot.state = 'hold';
            bot.holdPoint = bot.lastSeen || { x: bot.pos.x, z: bot.pos.z };
            bot.holdLook = bot.yaw;
          }
          faceToward(bot, bot.pos.x + bot.vel.x, bot.pos.z + bot.vel.z, dt, 5);
          break;
        }
        case 'hold': {
          bot.vel.x *= Math.max(0, 1 - dt * 7);
          bot.vel.z *= Math.max(0, 1 - dt * 7);
          // scan the angle it was assigned, slowly
          bot.holdScan += dt * 0.5;
          const sweep = Math.sin(bot.holdScan) * 0.42;
          faceAngle(bot, bot.holdLook + sweep, dt, 3.4);
          bot.pitch += (0 - bot.pitch) * Math.min(1, dt * 2);
          bot.crouch = !!bot.holdCrouch;
          // if the charge is down and we are attacking, hold the site instead
          break;
        }
        case 'engage': {
          const target = bot.target;
          if (!target || !target.alive) { bot.state = 'advance'; bot.target = null; break; }
          if (now - bot.lastSeenAt > 1.4) { bot.state = 'hunt'; break; }
          engage(bot, target, dt, now, ctx);
          break;
        }
        default: break;
      }

      // ---- objective hooks ----
      if (ctx.charge.planted && !ctx.charge.defused && !ctx.charge.detonated) {
        if (bot.team === 'warden' && bot.state !== 'engage' && !bot.action) {
          const d = Math.hypot(ctx.plantSpot.x - bot.pos.x, ctx.plantSpot.z - bot.pos.z);
          if (d < 2.0) {
            bot.action = 'defuse';
            bot.actionProgress = 0;
          } else if (bot.role !== 'anchor' || ctx.charge.fuseLeft < 30) {
            if (now > bot.repathAt) { bot.repathAt = now + 1.0; setPath(bot, ctx.plantSpot.x, ctx.plantSpot.z); }
            followPath(bot, dt, 4.8);
          }
        } else if (bot.team === 'cinder' && !bot.action) {
          // after the plant, spread around the site and hold the angles
          if (bot.role === 'sapper' && !bot.holdPoint) {
            bot.holdPoint = { x: ctx.plantSpot.x + 3, z: ctx.plantSpot.z + 3 };
            setPath(bot, bot.holdPoint.x, bot.holdPoint.z);
          }
        }
      }

      // The carrier plants whenever it is on the pad and not actively being shot off it.
      if (bot.team === 'cinder' && bot.role === 'sapper' && !ctx.charge.planted && !bot.action && clock.t - bot.lastHurtAt > 0.6) {
        const d = Math.hypot(ctx.plantSpot.x - bot.pos.x, ctx.plantSpot.z - bot.pos.z);
        if (d < 2.1) {
          bot.action = 'plant';
          bot.actionProgress = 0;
          bot.vel.x = 0;
          bot.vel.z = 0;
          onEvent({ type: 'plantStart', bot });
        } else if (bot.state === 'hold' || bot.state === 'hunt') {
          // never idle short of the site: the charge is the round
          setPath(bot, ctx.plantSpot.x, ctx.plantSpot.z);
          bot.state = 'advance';
        }
      }

      moveBody(bot, dt);
      if (bot.arsenal.reloading > 0) {
        bot.arsenal.reloading -= dt;
        if (bot.arsenal.reloading <= 0) bot.arsenal.finishReload();
      }
      animate(bot, dt, now);
    }
  }

  // ---- model animation ----------------------------------------------------------------------
  function animate(bot, dt, now) {
    const body = bot.body;
    const planar = Math.hypot(bot.vel.x, bot.vel.z);
    bot.stepPhase += dt * (1.5 + planar * 2.4);
    const swing = Math.sin(bot.stepPhase * Math.PI * 2) * Math.min(1, planar / 4) * 0.55;
    body.legs[0].rotation.x = swing;
    body.legs[1].rotation.x = -swing;
    body.arms[0].rotation.x = -swing * 0.4 + (bot.action === 'plant' || bot.action === 'defuse' ? -0.9 : 0);
    body.arms[1].rotation.x = swing * 0.4 - (bot.action === 'plant' || bot.action === 'defuse' ? 0.9 : 0);
    body.hips.position.y = 0.86 + Math.abs(swing) * 0.035 + (bot.action === 'plant' ? -0.32 : 0) + (bot.action === 'defuse' ? -0.42 : 0);
    body.root.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    body.root.rotation.y = bot.yaw;
    // pitch comes out of the spine rather than the whole body
    body.hips.rotation.x = clamp(bot.pitch * 0.35, -0.4, 0.5);
    body.head.rotation.x = clamp(bot.pitch * 0.5, -0.5, 0.7);
    body.rifle.position.z = THREE.MathUtils.lerp(body.rifle.position.z, 0.16, Math.min(1, dt * 14));
    body.led.material.emissiveIntensity = 1.4 + Math.sin(now * 6) * 0.8;
    if (bot.state === 'dead' || !bot.alive) return;
    // a crouched bot is shorter on screen as well as in the hitbox
    const wantCrouch = bot.crouch || bot.action === 'defuse' || bot.action === 'plant';
    bot.crouchAmount += ((wantCrouch ? 1 : 0) - bot.crouchAmount) * Math.min(1, dt * 8);
    body.root.scale.y = 1 - bot.crouchAmount * 0.28;
  }

  return {
    bots,
    spawn,
    buyPhase,
    assignRound,
    update,
    hit,
    eyeOf,
    names: NAMES,
    clear() {
      for (const bot of bots) scene.remove(bot.body.root);
      bots.length = 0;
    },
  };
}
