// Pools for everything that flies: sparks, smoke, tracers, bullet holes and shockwaves. Each pool
// is allocated once at boot and recycled; update() walks flat arrays and never creates objects.
import * as THREE from 'three';
import { LIMITS } from './config.js';

const HIDDEN = -9999;

function noop() {}

export function createEffects(scene) {
  // Soft round sprite so points read as embers and puffs, not squares.
  const discCanvas = document.createElement('canvas');
  discCanvas.width = 64;
  discCanvas.height = 64;
  const discCtx = discCanvas.getContext('2d');
  const discGradient = discCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
  discGradient.addColorStop(0, 'rgba(255,255,255,1)');
  discGradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  discGradient.addColorStop(1, 'rgba(255,255,255,0)');
  discCtx.fillStyle = discGradient;
  discCtx.fillRect(0, 0, 64, 64);
  const discTexture = new THREE.CanvasTexture(discCanvas);
  discTexture.colorSpace = THREE.SRGBColorSpace;

  // ---- sparks: additive points, one geometry, colours per vertex
  const sparkPositions = new Float32Array(LIMITS.particles * 3);
  const sparkColors = new Float32Array(LIMITS.particles * 3);
  const sparkVelocity = new Float32Array(LIMITS.particles * 3);
  const sparkLife = new Float32Array(LIMITS.particles);
  const sparkMax = new Float32Array(LIMITS.particles);
  const sparkGravity = new Float32Array(LIMITS.particles);
  for (let i = 0; i < LIMITS.particles; i += 1) sparkPositions[i * 3 + 1] = HIDDEN;
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3).setUsage(THREE.DynamicDrawUsage));
  const sparkMaterial = new THREE.PointsMaterial({
    size: 0.085,
    map: discTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);
  let sparkCursor = 0;

  // ---- smoke: normal blending, darker, larger and slower
  const smokePositions = new Float32Array(160 * 3);
  const smokeColors = new Float32Array(160 * 3);
  const smokeVelocity = new Float32Array(160 * 3);
  const smokeLife = new Float32Array(160);
  const smokeMax = new Float32Array(160);
  const smokeRise = new Float32Array(160);
  for (let i = 0; i < 160; i += 1) smokePositions[i * 3 + 1] = HIDDEN;
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3).setUsage(THREE.DynamicDrawUsage));
  smokeGeometry.setAttribute('color', new THREE.BufferAttribute(smokeColors, 3).setUsage(THREE.DynamicDrawUsage));
  const smokeMaterial = new THREE.PointsMaterial({
    size: 0.42,
    map: discTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const smokePoints = new THREE.Points(smokeGeometry, smokeMaterial);
  smokePoints.frustumCulled = false;
  scene.add(smokePoints);
  let smokeCursor = 0;

  // ---- tracers: thin stretched boxes, additive amber, life of a few frames
  const tracerGeometry = new THREE.BoxGeometry(0.03, 0.03, 1);
  const tracerMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff9a3a'),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < LIMITS.tracers; i += 1) {
    const mesh = new THREE.Mesh(tracerGeometry, tracerMaterial);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0, length: 1 });
  }
  let tracerCursor = 0;

  // ---- decals: pooled quads, dim and dark so they read as craters not stickers
  const decalGeometry = new THREE.CircleGeometry(0.09, 9);
  const decalMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#07090b'),
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const decals = [];
  for (let i = 0; i < LIMITS.decals; i += 1) {
    const mesh = new THREE.Mesh(decalGeometry, decalMaterial);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    decals.push({ mesh, life: 0 });
  }
  let decalCursor = 0;

  // ---- shockwaves: expanding rings for brute slams and spawn pops
  const ringGeometry = new THREE.RingGeometry(0.9, 1.0, 36);
  const shockwaves = [];
  for (let i = 0; i < 8; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffcf8a'),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    shockwaves.push({ mesh, material, life: 0, max: 0.4, scale: 1 });
  }
  let shockCursor = 0;

  const scratchColor = new THREE.Color();

  function emitSpark(x, y, z, vx, vy, vz, color, life, gravity) {
    const index = sparkCursor;
    sparkCursor = (sparkCursor + 1) % LIMITS.particles;
    const o = index * 3;
    sparkPositions[o] = x;
    sparkPositions[o + 1] = y;
    sparkPositions[o + 2] = z;
    sparkVelocity[o] = vx;
    sparkVelocity[o + 1] = vy;
    sparkVelocity[o + 2] = vz;
    scratchColor.setHex(color);
    sparkColors[o] = scratchColor.r;
    sparkColors[o + 1] = scratchColor.g;
    sparkColors[o + 2] = scratchColor.b;
    sparkLife[index] = life;
    sparkMax[index] = life;
    sparkGravity[index] = gravity;
  }

  function emitSmoke(x, y, z, vx, vy, vz, shade, life) {
    const index = smokeCursor;
    smokeCursor = (smokeCursor + 1) % 160;
    const o = index * 3;
    smokePositions[o] = x;
    smokePositions[o + 1] = y;
    smokePositions[o + 2] = z;
    smokeVelocity[o] = vx;
    smokeVelocity[o + 1] = vy;
    smokeVelocity[o + 2] = vz;
    smokeColors[o] = shade;
    smokeColors[o + 1] = shade;
    smokeColors[o + 2] = shade;
    smokeLife[index] = life;
    smokeMax[index] = life;
    smokeRise[index] = 0.35 + Math.random() * 0.4;
  }

  function sparkBurst(point, normal, color, count, power = 3.4) {
    for (let i = 0; i < count; i += 1) {
      const rx = Math.random() * 2 - 1;
      const ry = Math.random() * 2 - 1;
      const rz = Math.random() * 2 - 1;
      const len = Math.hypot(rx, ry, rz) || 1;
      const push = (0.4 + Math.random()) * power;
      emitSpark(
        point.x, point.y, point.z,
        (rx / len) * push + normal.x * power * 0.5,
        (ry / len) * push + normal.y * power * 0.5 + 1.2,
        (rz / len) * push + normal.z * power * 0.5,
        color,
        0.18 + Math.random() * 0.4,
        9.5,
      );
    }
  }

  function bloodBurst(point, direction, color, count) {
    for (let i = 0; i < count; i += 1) {
      const spread = 1.6;
      emitSpark(
        point.x, point.y, point.z,
        direction.x * 2.2 + (Math.random() - 0.5) * spread,
        direction.y * 2.2 + (Math.random() - 0.2) * spread + 0.7,
        direction.z * 2.2 + (Math.random() - 0.5) * spread,
        color,
        0.28 + Math.random() * 0.3,
        11,
      );
    }
  }

  function deathBurst(point, color) {
    for (let i = 0; i < 22; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4.5;
      emitSpark(
        point.x, point.y + Math.random() * 0.9, point.z,
        Math.cos(angle) * speed,
        1.0 + Math.random() * 3.4,
        Math.sin(angle) * speed,
        color,
        0.4 + Math.random() * 0.5,
        12,
      );
    }
    for (let i = 0; i < 5; i += 1) {
      emitSmoke(point.x + (Math.random() - 0.5) * 0.5, point.y + 0.4 + Math.random() * 0.5, point.z + (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5, 0.4 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5, 0.22, 0.9 + Math.random() * 0.5);
    }
  }

  function tracer(from, to) {
    const entry = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % LIMITS.tracers;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz) || 0.1;
    entry.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    entry.mesh.lookAt(to.x, to.y, to.z);
    entry.mesh.scale.set(1, 1, length);
    entry.mesh.visible = true;
    entry.life = 0.055;
    entry.length = length;
  }

  function decal(point, normal) {
    const entry = decals[decalCursor];
    decalCursor = (decalCursor + 1) % LIMITS.decals;
    entry.mesh.position.copy(point).addScaledVector(normal, 0.012);
    entry.mesh.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    entry.mesh.rotation.z = Math.random() * Math.PI;
    entry.mesh.scale.setScalar(0.8 + Math.random() * 0.7);
    entry.mesh.visible = true;
    entry.life = 14;
  }

  function shockwave(x, y, z, color, scale = 1) {
    const entry = shockwaves[shockCursor];
    shockCursor = (shockCursor + 1) % shockwaves.length;
    entry.mesh.position.set(x, y, z);
    entry.mesh.visible = true;
    entry.material.color.setHex(color);
    entry.material.opacity = 0.85;
    entry.scale = scale;
    entry.life = entry.max;
    entry.mesh.scale.setScalar(scale);
  }

  function muzzleSmoke(point, direction) {
    for (let i = 0; i < 2; i += 1) {
      emitSmoke(
        point.x + direction.x * 0.2, point.y + direction.y * 0.2, point.z + direction.z * 0.2,
        direction.x * 1.1 + (Math.random() - 0.5) * 0.4,
        direction.y * 1.1 + 0.25,
        direction.z * 1.1 + (Math.random() - 0.5) * 0.4,
        0.34,
        0.5 + Math.random() * 0.35,
      );
    }
  }

  function update(dt) {
    // Sparks
    for (let i = 0; i < LIMITS.particles; i += 1) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] -= dt;
      const o = i * 3;
      if (sparkLife[i] <= 0) {
        sparkPositions[o + 1] = HIDDEN;
        continue;
      }
      sparkVelocity[o + 1] -= sparkGravity[i] * dt;
      sparkPositions[o] += sparkVelocity[o] * dt;
      sparkPositions[o + 1] += sparkVelocity[o + 1] * dt;
      sparkPositions[o + 2] += sparkVelocity[o + 2] * dt;
      if (sparkPositions[o + 1] < 0.02) {
        sparkPositions[o + 1] = 0.02;
        sparkVelocity[o + 1] *= -0.35;
        sparkVelocity[o] *= 0.6;
        sparkVelocity[o + 2] *= 0.6;
      }
      const fade = sparkLife[i] / sparkMax[i];
      sparkColors[o] *= 0.985;
      sparkColors[o + 1] *= 0.985 * (0.9 + fade * 0.1);
      sparkColors[o + 2] *= 0.985;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkGeometry.attributes.color.needsUpdate = true;

    // Smoke
    for (let i = 0; i < 160; i += 1) {
      if (smokeLife[i] <= 0) continue;
      smokeLife[i] -= dt;
      const o = i * 3;
      if (smokeLife[i] <= 0) {
        smokePositions[o + 1] = HIDDEN;
        continue;
      }
      smokeVelocity[o] *= 1 - dt * 1.8;
      smokeVelocity[o + 2] *= 1 - dt * 1.8;
      smokePositions[o] += smokeVelocity[o] * dt;
      smokePositions[o + 1] += smokeVelocity[o + 1] * dt + smokeRise[i] * dt;
      smokePositions[o + 2] += smokeVelocity[o + 2] * dt;
      const fade = smokeLife[i] / smokeMax[i];
      smokeColors[o] = 0.34 * fade;
      smokeColors[o + 1] = 0.34 * fade;
      smokeColors[o + 2] = 0.36 * fade;
    }
    smokeGeometry.attributes.position.needsUpdate = true;
    smokeGeometry.attributes.color.needsUpdate = true;

    // Tracers shrink and vanish fast.
    for (let i = 0; i < tracers.length; i += 1) {
      const entry = tracers[i];
      if (entry.life <= 0) continue;
      entry.life -= dt;
      if (entry.life <= 0) {
        entry.mesh.visible = false;
        continue;
      }
      entry.mesh.scale.z = entry.length * (entry.life / 0.055);
    }

    // Decals time out after a while, keeping the oldest holes recycled.
    for (let i = 0; i < decals.length; i += 1) {
      const entry = decals[i];
      if (entry.life <= 0) continue;
      entry.life -= dt;
      if (entry.life <= 0) entry.mesh.visible = false;
    }

    // Shockwaves expand and fade.
    for (let i = 0; i < shockwaves.length; i += 1) {
      const entry = shockwaves[i];
      if (entry.life <= 0) continue;
      entry.life -= dt;
      const t = 1 - Math.max(0, entry.life) / entry.max;
      entry.mesh.scale.setScalar(entry.scale * (0.4 + t * 6));
      entry.material.opacity = 0.85 * (1 - t);
      if (entry.life <= 0) entry.mesh.visible = false;
    }
  }

  return { sparkBurst, bloodBurst, deathBurst, tracer, decal, shockwave, muzzleSmoke, update, noop };
}