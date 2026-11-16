// The enemies: four silhouettes with their own silhouettes, speeds and attacks, built from one
// box geometry and shared materials, and pooled so a wave never allocates. Each has a telegraphed
// attack, a floating health bar, a hurt flash and a death fall. Steering slides along cover.
import * as THREE from 'three';
import { ENEMY_TYPES, PALETTE, clamp, damp } from './config.js';

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const HEAD = new THREE.SphereGeometry(0.5, 10, 8);
const PROJECTILE = new THREE.SphereGeometry(0.15, 8, 6);
const MAX_ENEMIES = 22;
const MAX_ORBS = 14;

export function createEnemies(scene, stage, effects, player, camera, sfx) {
  const colliders = stage.colliders;
  const probe = new THREE.Box3();

  // One material set per archetype: body, trim, eye, and a hot flash variant for hit feedback.
  const kits = {};
  for (const [name, def] of Object.entries(ENEMY_TYPES)) {
    kits[name] = {
      body: new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color), roughness: 0.72, metalness: 0.16 }),
      trim: new THREE.MeshStandardMaterial({ color: new THREE.Color('#232b31'), roughness: 0.6, metalness: 0.4 }),
      eye: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.danger), emissive: new THREE.Color(PALETTE.danger), emissiveIntensity: 3.4, roughness: 0.3 }),
      flash: new THREE.MeshStandardMaterial({
        color: new THREE.Color(def.color),
        emissive: new THREE.Color('#ffd9a0'),
        emissiveIntensity: 0.85,
        roughness: 0.5,
      }),
    };
  }
  const barBackMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0a0e11'), transparent: true, opacity: 0.75, depthWrite: false });
  const barFillMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.95, depthWrite: false });
  const barGeometry = new THREE.PlaneGeometry(1, 1);

  const enemies = [];
  const hitMeshes = [];

  function part(group, material, w, h, d, x, y, z, geometry = UNIT) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function build(type, index) {
    const kit = kits[type];
    const group = new THREE.Group();
    const rig = new THREE.Group();
    group.add(rig);
    const parts = [];
    let torso;
    let head;
    let eye;
    let legL;
    let legR;
    let armL;
    let armR;
    let barFill;
    let barBack;

    if (type === 'brute') {
      torso = part(rig, kit.body, 1.28, 1.05, 0.78, 0, 1.18, 0);
      part(rig, kit.trim, 0.62, 0.34, 0.5, 0, 1.78, 0.02);
      head = part(rig, kit.body, 0.5, 0.42, 0.46, 0, 1.9, 0.02, HEAD);
      eye = part(rig, kit.eye, 0.3, 0.09, 0.06, 0, 1.94, 0.26);
      part(rig, kit.trim, 0.46, 0.7, 0.6, -0.86, 1.34, 0);
      part(rig, kit.trim, 0.46, 0.7, 0.6, 0.86, 1.34, 0);
      armL = part(rig, kit.body, 0.34, 0.92, 0.34, -0.76, 0.78, 0.1);
      armR = part(rig, kit.body, 0.34, 0.92, 0.34, 0.76, 0.78, 0.1);
      legL = part(rig, kit.trim, 0.4, 0.78, 0.44, -0.4, 0.4, 0);
      legR = part(rig, kit.trim, 0.4, 0.78, 0.44, 0.4, 0.4, 0);
      parts.push(torso, head, armL, armR, legL, legR);
    } else if (type === 'sprinter') {
      rig.position.y = 0.12;
      rig.rotation.x = 0.34;
      torso = part(rig, kit.body, 0.5, 0.72, 0.38, 0, 0.92, 0);
      head = part(rig, kit.body, 0.34, 0.32, 0.34, 0, 1.36, 0.14, HEAD);
      eye = part(rig, kit.eye, 0.2, 0.06, 0.05, 0, 1.38, 0.34);
      armL = part(rig, kit.body, 0.14, 0.72, 0.14, -0.32, 1.0, 0.2);
      armR = part(rig, kit.body, 0.14, 0.72, 0.14, 0.32, 1.0, 0.2);
      legL = part(rig, kit.trim, 0.16, 0.62, 0.18, -0.16, 0.34, 0.04);
      legR = part(rig, kit.trim, 0.16, 0.62, 0.18, 0.16, 0.34, 0.04);
      parts.push(torso, head, armL, armR, legL, legR);
    } else if (type === 'spitter') {
      torso = part(rig, kit.body, 0.62, 0.86, 0.48, 0, 1.06, 0);
      part(rig, kit.trim, 0.5, 0.2, 0.2, 0, 1.5, 0.18);
      head = part(rig, kit.body, 0.36, 0.36, 0.36, 0, 1.47, 0.05, HEAD);
      eye = part(rig, kit.eye, 0.18, 0.07, 0.06, 0, 1.5, 0.24);
      // An acid sac on the back: the tell that this one shoots.
      part(rig, kit.eye, 0.34, 0.34, 0.34, 0, 1.24, -0.36, HEAD);
      armL = part(rig, kit.trim, 0.16, 0.62, 0.16, -0.38, 0.98, 0.12);
      armR = part(rig, kit.trim, 0.16, 0.62, 0.16, 0.38, 0.98, 0.12);
      legL = part(rig, kit.trim, 0.2, 0.72, 0.24, -0.2, 0.36, 0);
      legR = part(rig, kit.trim, 0.2, 0.72, 0.24, 0.2, 0.36, 0);
      parts.push(torso, head, armL, armR, legL, legR);
    } else {
      torso = part(rig, kit.body, 0.58, 0.82, 0.42, 0, 1.02, 0);
      part(rig, kit.trim, 0.66, 0.12, 0.48, 0, 1.36, 0);
      head = part(rig, kit.body, 0.34, 0.34, 0.34, 0, 1.5, 0.03, HEAD);
      eye = part(rig, kit.eye, 0.22, 0.06, 0.05, 0, 1.52, 0.2);
      armL = part(rig, kit.body, 0.16, 0.78, 0.16, -0.38, 1.0, 0);
      armR = part(rig, kit.body, 0.16, 0.78, 0.16, 0.38, 1.0, 0);
      legL = part(rig, kit.trim, 0.2, 0.66, 0.22, -0.18, 0.33, 0);
      legR = part(rig, kit.trim, 0.2, 0.66, 0.22, 0.18, 0.33, 0);
      parts.push(torso, head, armL, armR, legL, legR);
    }

    // Health bar: a dark backing and an amber fill, always turned to the camera.
    barBack = new THREE.Mesh(barGeometry, barBackMaterial);
    barFill = new THREE.Mesh(barGeometry, barFillMaterial);
    const barY = ENEMY_TYPES[type].height + 0.3;
    barBack.position.set(0, barY, 0);
    barFill.position.set(0, barY, 0.001);
    barBack.scale.set(0.9, 0.075, 1);
    barFill.scale.set(0.86, 0.045, 1);
    group.add(barBack, barFill);

    group.visible = false;
    scene.add(group);

    const def = ENEMY_TYPES[type];
    const enemy = {
      index,
      type,
      def,
      group,
      rig,
      parts,
      torso,
      head,
      eye,
      armL,
      armR,
      legL,
      legR,
      barFill,
      barBack,
      barWidth: 0.86,
      alive: false,
      active: false,
      health: 1,
      maxHealth: 1,
      speed: def.speed,
      damage: def.damage,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      radius: def.radius,
      phase: index * 1.7,
      attackTimer: 0,
      windup: 0,
      cooldown: 0,
      hurt: 0,
      flashTimer: 0,
      death: 0,
      spawnT: 0,
      score: def.score,
      lastHitPart: '',
      groundY: 0,
      strafe: index % 2 === 0 ? 1 : -1,
    };

    for (const mesh of [torso, head, armL, armR, legL, legR]) {
      mesh.userData.enemy = enemy;
      mesh.userData.part = mesh === head ? 'head' : 'body';
    }
    hitMeshes.push(torso, head, armL, armR, legL, legR);
    enemies.push(enemy);
    return enemy;
  }

  const POOL = { drifter: 7, sprinter: 7, brute: 4, spitter: 4 };
  for (const [type, count] of Object.entries(POOL)) {
    for (let i = 0; i < count; i += 1) build(type, enemies.length);
  }

  // Pooled enemy projectiles.
  const orbs = [];
  const orbMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < MAX_ORBS; i += 1) {
    const mesh = new THREE.Mesh(PROJECTILE, orbMaterial);
    mesh.visible = false;
    scene.add(mesh);
    orbs.push({ mesh, active: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), life: 0, damage: 12 });
  }
  let orbCursor = 0;

  const scratchBox = new THREE.Box3();
  const toPlayer = new THREE.Vector3();
  const orbDir = new THREE.Vector3();

  function blocked(x, z, radius, y, height) {
    scratchBox.min.set(x - radius, y + 0.12, z - radius);
    scratchBox.max.set(x + radius, y + height - 0.12, z + radius);
    for (let i = 0; i < colliders.length; i += 1) if (scratchBox.intersectsBox(colliders[i])) return true;
    return false;
  }

  function groundAt(x, z, fromY) {
    let best = 0;
    scratchBox.min.set(x - 0.2, -2, z - 0.2);
    scratchBox.max.set(x + 0.2, fromY + 0.5, z + 0.2);
    for (let i = 0; i < colliders.length; i += 1) {
      const box = colliders[i];
      if (scratchBox.intersectsBox(box) && box.max.y <= fromY + 0.52 && box.max.y > best) best = box.max.y;
    }
    return best;
  }

  // A ledge a body can step onto: something solid underfoot, no higher than half a metre.
  function ledgeNear(x, z, y, radius, height) {
    const top = groundAt(x, z, y + 0.55);
    if (top <= y + 0.02 || top > y + 0.52) return -1;
    return blocked(x, z, radius, top, height) ? -1 : top;
  }

  function setMaterial(enemy, material) {
    for (let i = 0; i < enemy.parts.length; i += 1) enemy.parts[i].material = material;
  }

  function spawn(type, x, z, healthScale, speedScale, waveNumber) {
    let enemy = null;
    // Prefer a free slot of the same silhouette; the pools are sized so one always exists.
    for (let i = 0; i < enemies.length; i += 1) {
      if (!enemies[i].active && enemies[i].type === type) {
        enemy = enemies[i];
        break;
      }
    }
    if (!enemy) {
      for (let i = 0; i < enemies.length; i += 1) {
        if (!enemies[i].active) {
          enemy = enemies[i];
          break;
        }
      }
    }
    if (!enemy) return null;

    const kit = kits[type];
    enemy.type = type;
    enemy.def = ENEMY_TYPES[type];

    enemy.active = true;
    enemy.alive = true;
    enemy.death = 0;
    enemy.spawnT = 0.45;
    enemy.hurt = 0;
    enemy.flashTimer = 0;
    enemy.windup = 0;
    enemy.attackTimer = 0;
    enemy.cooldown = 0.5 + Math.random() * 0.6;
    enemy.position.set(x, 0, z);
    enemy.velocity.set(0, 0, 0);
    enemy.groundY = groundAt(x, z, 1.2);
    enemy.radius = enemy.def.radius;
    enemy.speed = enemy.def.speed * speedScale;
    enemy.damage = enemy.def.damage;
    enemy.score = enemy.def.score;
    enemy.maxHealth = enemy.def.health * healthScale;
    enemy.health = enemy.maxHealth;
    enemy.phase = Math.random() * Math.PI * 2;
    enemy.strafe = Math.random() > 0.5 ? 1 : -1;
    enemy.group.visible = true;
    enemy.group.rotation.set(0, 0, 0);
    enemy.group.position.set(x, 0, z);
    enemy.group.scale.setScalar(1);
    enemy.rig.rotation.x = type === 'sprinter' ? 0.34 : 0;
    enemy.barBack.visible = false;
    enemy.barFill.visible = false;
    enemy.barFill.scale.x = enemy.barWidth;
    enemy.barBack.scale.x = 0.9;
    setMaterial(enemy, kits[type].body);
    enemy.parts = [enemy.torso, enemy.head, enemy.armL, enemy.armR, enemy.legL, enemy.legR];
    enemy.legL.material = kit.trim;
    enemy.legR.material = kit.trim;
    enemy.eye.material = kit.eye;
    enemy.health = enemy.maxHealth;
    return enemy;
  }

  function damage(mesh, amount, point, direction) {
    const enemy = mesh.userData.enemy;
    if (!enemy || !enemy.alive || enemy.spawnT > 0.28) return null;
    const head = mesh.userData.part === 'head';
    enemy.health -= amount;
    enemy.hurt = 1;
    enemy.flashTimer = 0.07;
    setMaterial(enemy, kits[enemy.type].flash);
    effects.bloodBurst(point, direction, head ? 0xffd27a : 0xd4553a, head ? 9 : 5);
    if (enemy.health > 0) {
      if (sfx) sfx.hit(head);
      return { killed: false, damage: amount, head };
    }
    enemy.alive = false;
    enemy.health = 0;
    enemy.death = 0;
    enemy.barBack.visible = false;
    enemy.barFill.visible = false;
    enemy.windup = 0;
    effects.deathBurst(enemy.position, enemy.type === 'brute' ? 0xb08cff : 0xff8a4a);
    effects.shockwave(enemy.position.x, enemy.groundY + 0.05, enemy.position.z, enemy.type === 'brute' ? 0xb08cff : 0xff9a4a, enemy.type === 'brute' ? 1.4 : 0.7);
    if (sfx) sfx.kill();
    return { killed: true, damage: enemy.maxHealth, head, score: enemy.score, position: enemy.position, type: enemy.type };
  }

  function fireOrb(enemy) {
    for (let i = 0; i < orbs.length; i += 1) {
      const orb = orbs[(orbCursor + i) % orbs.length];
      if (orb.active) continue;
      orbCursor = (orbCursor + i + 1) % orbs.length;
      orb.active = true;
      orb.mesh.visible = true;
      orb.life = 4.2;
      orb.damage = 11;
      orb.position.set(enemy.position.x, enemy.groundY + 1.35, enemy.position.z);
      toPlayer.copy(player.state.position);
      toPlayer.x += (Math.random() - 0.5) * 0.5;
      toPlayer.z += (Math.random() - 0.5) * 0.5;
      toPlayer.y = 1.1;
      toPlayer.sub(orb.position).normalize();
      const speed = 13.5;
      orb.velocity.copy(toPlayer).multiplyScalar(speed);
      orb.mesh.position.copy(orb.position);
      if (sfx) sfx.enemyShot();
      effects.sparkBurst(orb.position, toPlayer, 0xff6a3a, 8, 2.2);
      return;
    }
  }

  function step(dt, time) {
    const px = player.state.position.x;
    const pz = player.state.position.z;
    const alivePlayer = player.state.alive;

    for (let i = 0; i < enemies.length; i += 1) {
      const enemy = enemies[i];
      if (!enemy.active) continue;

      if (!enemy.alive) {
        // Death fall: pitch forward, sink a little, then retire the slot.
        enemy.death += dt;
        const t = Math.min(1, enemy.death / 0.55);
        enemy.rig.rotation.x = t * 1.35;
        enemy.group.position.y = -t * 0.28;
        enemy.group.scale.setScalar(1 - t * 0.06);
        if (enemy.death > 1.25) {
          enemy.active = false;
          enemy.group.visible = false;
        }
        continue;
      }

      enemy.spawnT = Math.max(0, enemy.spawnT - dt);
      const spawnScale = enemy.spawnT > 0 ? 1 - enemy.spawnT / 0.45 : 1;
      enemy.group.scale.setScalar(clamp(0.35 + spawnScale * 0.65, 0.3, 1));

      if (enemy.flashTimer > 0) {
        enemy.flashTimer -= dt;
        if (enemy.flashTimer <= 0) {
          setMaterial(enemy, kits[enemy.type].body);
          enemy.legL.material = kits[enemy.type].trim;
          enemy.legR.material = kits[enemy.type].trim;
        }
      }

      const dx = px - enemy.position.x;
      const dz = pz - enemy.position.z;
      const distance = Math.hypot(dx, dz) || 0.001;
      const dirX = dx / distance;
      const dirZ = dz / distance;

      // Face the player; spitters and drifters turn slower so a flank reads clearly.
      const targetYaw = Math.atan2(dirX, dirZ);
      let yawDelta = targetYaw - enemy.group.rotation.y;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      enemy.group.rotation.y += yawDelta * Math.min(1, dt * (enemy.type === 'sprinter' ? 9 : 4.2));

      const reach = enemy.radius + 0.95;
      let moveX = 0;
      let moveZ = 0;

      if (enemy.def.ranged) {
        // Spitters keep a firing band: close in past 11 m, back off inside 5 m, strafe between.
        const ideal = 8.5;
        const approach = distance > ideal + 1.5 ? 1 : distance < ideal - 2 ? -0.8 : 0;
        moveX = dirX * approach + -dirZ * enemy.strafe * 0.55;
        moveZ = dirZ * approach + dirX * enemy.strafe * 0.55;
      } else if (distance > reach + 0.15) {
        moveX = dirX;
        moveZ = dirZ;
        // A slight weave so a straight line of fire is not a guaranteed hit.
        if (enemy.type === 'sprinter') {
          moveX += -dirZ * Math.sin(time * 3 + enemy.phase) * 0.35;
          moveZ += dirX * Math.sin(time * 3 + enemy.phase) * 0.35;
        }
      }

      const length = Math.hypot(moveX, moveZ);
      if (length > 0.001) {
        moveX /= length;
        moveZ /= length;
      }

      // Separation: enemies shoulder past each other instead of stacking into one target.
      for (let j = 0; j < enemies.length; j += 1) {
        if (j === i) continue;
        const other = enemies[j];
        if (!other.active || !other.alive) continue;
        const ox = enemy.position.x - other.position.x;
        const oz = enemy.position.z - other.position.z;
        const od = Math.hypot(ox, oz);
        const min = enemy.radius + other.radius;
        if (od > 0.0001 && od < min) {
          const push = (min - od) / min;
          moveX += (ox / od) * push * 1.6;
          moveZ += (oz / od) * push * 1.6;
        }
      }

      const speed = enemy.speed * (enemy.windup > 0 ? 0.15 : 1);
      const nextX = enemy.position.x + moveX * speed * dt;
      const nextZ = enemy.position.z + moveZ * speed * dt;

      // Step onto a real ledge (the centre platform, a crate top) only when one is underfoot;
      // "not blocked" alone let enemies ratchet upward against cover.
      if (!blocked(nextX, enemy.position.z, enemy.radius, enemy.position.y, enemy.def.height)) {
        enemy.position.x = nextX;
      } else {
        const ledge = ledgeNear(nextX, enemy.position.z, enemy.position.y, enemy.radius, enemy.def.height);
        if (ledge >= 0) {
          enemy.position.x = nextX;
          enemy.position.y = ledge;
        }
      }
      if (!blocked(enemy.position.x, nextZ, enemy.radius, enemy.position.y, enemy.def.height)) {
        enemy.position.z = nextZ;
      } else {
        const ledge = ledgeNear(enemy.position.x, nextZ, enemy.position.y, enemy.radius, enemy.def.height);
        if (ledge >= 0) {
          enemy.position.z = nextZ;
          enemy.position.y = ledge;
        }
      }

      enemy.groundY = groundAt(enemy.position.x, enemy.position.z, enemy.position.y + 0.2);
      enemy.position.y = damp(enemy.position.y, enemy.groundY, 16, dt);

      // Attack: wind up, then land it if the player is still close.
      if (enemy.cooldown > 0) enemy.cooldown -= dt;
      if (enemy.windup > 0) {
        enemy.windup -= dt;
        if (enemy.windup <= 0) {
          if (enemy.def.ranged) {
            fireOrb(enemy);
          } else if (distance < reach + 0.85 && alivePlayer) {
            player.damage(enemy.damage);
            if (sfx) sfx.playerHit();
            effects.shockwave(px, 0.08, pz, 0xff5a3a, 0.7);
          }
          enemy.cooldown = enemy.type === 'brute' ? 1.75 : 1.05;
        }
      } else if (enemy.cooldown <= 0 && enemy.spawnT <= 0) {
        if (enemy.def.ranged && distance < 17 && distance > 3.2) {
          enemy.windup = 0.55;
          enemy.cooldown = 99;
          if (sfx) sfx.spawnTelegraph();
        } else if (!enemy.def.ranged && distance < reach + 0.7) {
          enemy.windup = enemy.type === 'brute' ? 0.62 : 0.34;
          enemy.cooldown = 99;
          if (enemy.type === 'brute') effects.shockwave(enemy.position.x, enemy.groundY + 0.05, enemy.position.z, 0xffc46a, 0.5);
        }
      }

      // Gait and attack pose.
      const gait = Math.hypot(moveX, moveZ) * speed;
      enemy.phase += dt * (2.6 + gait * 1.35);
      const swing = Math.sin(enemy.phase) * Math.min(0.95, 0.28 + gait * 0.12);
      const armSwing = -swing * 0.8;
      if (enemy.type === 'brute') {
        enemy.legL.rotation.x = swing * 0.45;
        enemy.legR.rotation.x = -swing * 0.45;
        enemy.armL.rotation.x = -0.28 + Math.sin(enemy.phase * 2) * 0.12;
        enemy.armR.rotation.x = -0.28 - Math.sin(enemy.phase * 2) * 0.12;
      } else if (enemy.type === 'spitter') {
        enemy.legL.rotation.x = swing * 0.8;
        enemy.legR.rotation.x = -swing * 0.8;
        enemy.armL.rotation.x = -1.25;
        enemy.armR.rotation.x = -1.25;
        enemy.eye.material.emissiveIntensity = 2.2 + (enemy.windup > 0 ? 6 : 0);
      } else {
        enemy.legL.rotation.x = swing;
        enemy.legR.rotation.x = -swing;
        enemy.armL.rotation.x = armSwing;
        enemy.armR.rotation.x = -armSwing;
      }

      if (enemy.windup > 0) {
        const windT = 1 - enemy.windup / (enemy.type === 'brute' ? 0.62 : enemy.def.ranged ? 0.55 : 0.34);
        enemy.rig.rotation.x = -0.35 * Math.sin(windT * Math.PI) * (enemy.type === 'brute' ? 1 : 0.6);
        enemy.rig.position.z = -0.18 * Math.sin(windT * Math.PI);
        if (enemy.def.ranged) enemy.rig.position.z = 0.12 * Math.sin(windT * Math.PI);
      } else {
        enemy.rig.rotation.x = damp(enemy.rig.rotation.x, enemy.type === 'sprinter' ? 0.34 : 0, 8, dt);
        enemy.rig.position.z = damp(enemy.rig.position.z, 0, 9, dt);
      }

      enemy.hurt = Math.max(0, enemy.hurt - dt * 3);
      enemy.group.position.set(enemy.position.x, enemy.position.y, enemy.position.z);

      // Health bar: only show once the creature has been hit, and face the camera.
      const frac = clamp(enemy.health / enemy.maxHealth, 0, 1);
      enemy.barFill.scale.x = enemy.barWidth * frac;
      enemy.barFill.position.x = -(enemy.barWidth * (1 - frac)) / 2;
      enemy.barBack.quaternion.copy(camera.quaternion);
      enemy.barFill.quaternion.copy(camera.quaternion);
      enemy.barBack.visible = enemy.hurt > 0 || frac < 0.999;
      enemy.barFill.visible = enemy.barBack.visible;
    }

    // Projectiles: travel, trail, hit the world or the player.
    for (let i = 0; i < orbs.length; i += 1) {
      const orb = orbs[i];
      if (!orb.active) continue;
      orb.life -= dt;
      if (orb.life <= 0) {
        orb.active = false;
        orb.mesh.visible = false;
        continue;
      }
      orb.position.addScaledVector(orb.velocity, dt);
      orb.mesh.position.copy(orb.position);
      orbDir.copy(orb.velocity).normalize();
      effects.sparkBurst(orb.position, orbDir, 0xff7a3a, 1, 0.4);
      const px2 = player.state.position.x;
      const pz2 = player.state.position.z;
      const py2 = player.state.position.y + 1.0;
      const dist = Math.hypot(orb.position.x - px2, orb.position.y - py2, orb.position.z - pz2);
      if (dist < 0.62 && alivePlayer) {
        player.damage(orb.damage);
        if (sfx) sfx.playerHit();
        effects.shockwave(orb.position.x, orb.position.y, orb.position.z, 0xff5a3a, 0.6);
        effects.sparkBurst(orb.position, orb.velocity, 0xff7a3a, 12, 3);
        orb.active = false;
        orb.mesh.visible = false;
        continue;
      }
      if (orb.position.y < 0.05) {
        effects.sparkBurst(orb.position, new THREE.Vector3(0, 1, 0), 0xff7a3a, 10, 2.4);
        orb.active = false;
        orb.mesh.visible = false;
      }
    }
  }

  function aliveCount() {
    let count = 0;
    for (let i = 0; i < enemies.length; i += 1) if (enemies[i].active && enemies[i].alive) count += 1;
    return count;
  }

  function clear() {
    for (let i = 0; i < enemies.length; i += 1) {
      const enemy = enemies[i];
      if (!enemy.active) continue;
      enemy.active = false;
      enemy.alive = false;
      enemy.group.visible = false;
      enemy.barBack.visible = false;
      enemy.barFill.visible = false;
    }
    for (let i = 0; i < orbs.length; i += 1) {
      orbs[i].active = false;
      orbs[i].mesh.visible = false;
    }
  }

  return {
    enemies,
    hitMeshes,
    spawn,
    step,
    damage,
    clear,
    aliveCount,
    projectileCount() {
      let count = 0;
      for (let i = 0; i < orbs.length; i += 1) if (orbs[i].active) count += 1;
      return count;
    },
  };
}