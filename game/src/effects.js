// Visual feedback, all of it pooled: tracers, impact sparks, dust, blood, decals and the muzzle
// flash. Nothing here allocates during play — the particle cloud is one Points object updated in
// place, the tracer quads and decal quads are created once and recycled.

import * as THREE from 'three';

const PARTICLE_COUNT = 320;
const TRACERS = 48;
const DECALS = 56;

const SPARK = new THREE.Color('#ffd28a');
const DUST = new THREE.Color('#b8b2a2');
const BLOOD = new THREE.Color('#8f2318');
const METAL = new THREE.Color('#ffe6b0');

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,214,150,.8)');
  grd.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(8,8,8,.95)');
  grd.addColorStop(0.35, 'rgba(20,18,16,.75)');
  grd.addColorStop(0.6, 'rgba(70,64,56,.35)');
  grd.addColorStop(1, 'rgba(70,64,56,0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(32, 32, 31, 0, Math.PI * 2);
  ctx.fill();
  // a few radial cracks
  ctx.strokeStyle = 'rgba(12,10,8,.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 7; i += 1) {
    const a = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    ctx.lineTo(32 + Math.cos(a) * (14 + Math.random() * 14), 32 + Math.sin(a) * (14 + Math.random() * 14));
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createEffects(scene, camera) {
  // ---- particle cloud ------------------------------------------------------------------------
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const velocities = new Float32Array(PARTICLE_COUNT * 3);
  const life = new Float32Array(PARTICLE_COUNT);
  const maxLife = new Float32Array(PARTICLE_COUNT);
  const gravity = new Float32Array(PARTICLE_COUNT);
  const drag = new Float32Array(PARTICLE_COUNT);
  const baseSize = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    positions[i * 3 + 1] = -999;
    sizes[i] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('pcolor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const sprite = glowTexture();
  // A tiny point-sprite shader: per-particle size and colour (PointsMaterial has neither), one
  // draw call, additive so sparks bloom on the concrete.
  const particleMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: sprite } },
    vertexShader: `
      attribute float size;
      attribute vec3 pcolor;
      varying vec3 vColor;
      void main() {
        vColor = pcolor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (420.0 / max(0.15, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        if (tex.a < 0.03) discard;
        gl_FragColor = vec4(vColor * tex.rgb, tex.a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, particleMat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  let cursor = 0;
  function spawn(x, y, z, vx, vy, vz, color, size, ttl, grav = 9, dragK = 2.2) {
    const i = cursor;
    cursor = (cursor + 1) % PARTICLE_COUNT;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocities[i * 3] = vx;
    velocities[i * 3 + 1] = vy;
    velocities[i * 3 + 2] = vz;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    baseSize[i] = size;
    sizes[i] = size;
    life[i] = ttl;
    maxLife[i] = ttl;
    gravity[i] = grav;
    drag[i] = dragK;
  }

  // ---- tracers ------------------------------------------------------------------------------
  const tracerGeo = new THREE.BoxGeometry(0.014, 0.014, 1);
  const tracerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffb877'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerCursor = 0;

  // ---- decals -------------------------------------------------------------------------------
  const holeTex = holeTexture();
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const decals = [];
  for (let i = 0; i < DECALS; i += 1) {
    const mat = new THREE.MeshBasicMaterial({
      map: holeTex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(decalGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    decals.push({ mesh, life: 0 });
  }
  let decalCursor = 0;

  // ---- muzzle flash -------------------------------------------------------------------------
  const flashMat = new THREE.MeshBasicMaterial({
    map: sprite, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat);
  flash.visible = false;
  flash.renderOrder = 6; // over the weapon, never z-fighting with its own barrel
  scene.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color('#ffc07a'), 0, 9, 2);
  scene.add(flashLight);
  let flashLife = 0;
  let flashMax = 0.05;

  const tmpDir = new THREE.Vector3();
  const tmpUp = new THREE.Vector3(0, 1, 0);

  return {
    // A bright line from the muzzle to the hit point, gone in a blink.
    tracer(fromX, fromY, fromZ, toX, toY, toZ) {
      const t = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % TRACERS;
      const dx = toX - fromX;
      const dy = toY - fromY;
      const dz = toZ - fromZ;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.2) return;
      t.mesh.position.set(fromX + dx * 0.5, fromY + dy * 0.5, fromZ + dz * 0.5);
      t.mesh.scale.set(1, 1, len);
      t.mesh.lookAt(toX, toY, toZ);
      t.mesh.visible = true;
      t.mesh.material.opacity = 0.55;
      t.life = 0.055;
    },

    // Sparks for metal, dust and chips for concrete, a red spray for a body.
    impact(x, y, z, nx, ny, nz, kind = 'concrete') {
      const color = kind === 'metal' ? METAL : kind === 'flesh' ? BLOOD : DUST;
      const count = kind === 'flesh' ? 7 : 10;
      for (let i = 0; i < count; i += 1) {
        const spread = kind === 'flesh' ? 2.2 : 3.4;
        const vx = nx * 1.6 + (Math.random() - 0.5) * spread;
        const vy = ny * 1.6 + Math.random() * spread * 0.8;
        const vz = nz * 1.6 + (Math.random() - 0.5) * spread;
        spawn(x, y, z, vx, vy, vz, color, 0.09 + Math.random() * 0.11, 0.22 + Math.random() * 0.3, kind === 'flesh' ? 14 : 11, 3.4);
      }
      // a short-lived bright core so the hit point itself pops
      spawn(x, y, z, nx * 0.4, ny * 0.4 + 0.3, nz * 0.4, SPARK, 0.24, 0.06, 0, 6);
      if (kind !== 'flesh') this.decal(x, y, z, nx, ny, nz);
    },

    decal(x, y, z, nx, ny, nz) {
      const d = decals[decalCursor];
      decalCursor = (decalCursor + 1) % DECALS;
      d.mesh.position.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
      tmpDir.set(nx, ny, nz);
      // a decal on a wall faces the shooter; on the floor it faces up
      d.mesh.lookAt(x + nx, y + ny, z + nz);
      d.mesh.rotateZ(Math.random() * Math.PI * 2);
      const s = 0.13 + Math.random() * 0.09;
      d.mesh.scale.set(s, s, s);
      d.mesh.visible = true;
      d.mesh.material.opacity = 0.9;
      d.life = 14;
    },

    // Muzzle flash sits at the gun, lights the room for two frames and is gone.
    muzzle(x, y, z) {
      flash.position.set(x, y, z);
      flash.quaternion.copy(camera.quaternion); // face the shooter from the first frame
      flash.scale.setScalar(0.19 + Math.random() * 0.06);
      flash.rotation.z = Math.random() * Math.PI * 2;
      flash.visible = true;
      flashMat.opacity = 0.8;
      flashLife = 0.05;
      flashMax = 0.05;
      flashLight.position.set(x, y, z);
      flashLight.intensity = 14;
    },

    // Death puff: a body dropping leaves a little dust and a stain on the floor.
    death(x, y, z) {
      for (let i = 0; i < 16; i += 1) {
        spawn(
          x + (Math.random() - 0.5) * 0.5, y + Math.random() * 1.2, z + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 2.2, Math.random() * 1.6, (Math.random() - 0.5) * 2.2,
          BLOOD, 0.1 + Math.random() * 0.14, 0.5 + Math.random() * 0.4, 12, 2.6,
        );
      }
    },

    // The charge going off: a fireball of embers and a flash that lifts the room.
    detonation(x, y, z) {
      for (let i = 0; i < 90; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 2.2;
        spawn(
          x, y + 0.4, z,
          Math.cos(a) * r * 2.4, 1.6 + Math.random() * 5.5, Math.sin(a) * r * 2.4,
          i % 3 === 0 ? SPARK : DUST, 0.2 + Math.random() * 0.3, 0.7 + Math.random() * 0.8, 6, 1.2,
        );
      }
      flash.position.set(x, y + 1.2, z);
      flash.scale.setScalar(9);
      flash.visible = true;
      flashMat.opacity = 1;
      flashLife = 0.5;
      flashMax = 0.5;
      flashLight.position.set(x, y + 1.5, z);
      flashLight.intensity = 60;
    },

    // Smoke column while the fuse burns — thin, dark, rising.
    smoke(x, y, z, color = DUST) {
      spawn(
        x + (Math.random() - 0.5) * 0.2, y + 0.2, z + (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.7, (Math.random() - 0.5) * 0.4,
        color, 0.28 + Math.random() * 0.2, 1.1 + Math.random() * 0.6, -0.6, 0.6,
      );
    },

    update(dt) {
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          sizes[i] = 0;
          positions[i * 3 + 1] = -999;
          continue;
        }
        const damp = Math.max(0, 1 - drag[i] * dt);
        velocities[i * 3] *= damp;
        velocities[i * 3 + 1] = velocities[i * 3 + 1] * damp - gravity[i] * dt;
        velocities[i * 3 + 2] *= damp;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        if (positions[i * 3 + 1] < 0.02) {
          positions[i * 3 + 1] = 0.02;
          velocities[i * 3 + 1] *= -0.24;
        }
        const f = life[i] / maxLife[i];
        sizes[i] = baseSize[i] * (0.35 + f * 0.9);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
      geo.attributes.pcolor.needsUpdate = true;

      for (let i = 0; i < tracers.length; i += 1) {
        const t = tracers[i];
        if (t.life <= 0) continue;
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / 0.055) * 0.55;
        if (t.life <= 0) t.mesh.visible = false;
      }
      for (let i = 0; i < decals.length; i += 1) {
        const d = decals[i];
        if (d.life <= 0) continue;
        d.life -= dt;
        if (d.life <= 0) d.mesh.visible = false;
        else if (d.life < 2) d.mesh.material.opacity = 0.9 * (d.life / 2);
      }
      if (flashLife > 0) {
        flashLife -= dt;
        flashMat.opacity = Math.max(0, flashLife / flashMax);
        flashLight.intensity = Math.max(0, 14 * (flashLife / flashMax));
        if (flashLife <= 0) flash.visible = false;
      }
      // billboard the flash at the camera
      if (flash.visible) flash.quaternion.copy(camera.quaternion);
    },
  };
}
