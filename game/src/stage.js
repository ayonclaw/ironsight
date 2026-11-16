// The arena: a walled industrial yard built from one box geometry and a handful of shared
// materials, with concrete textures painted into canvases at boot (no files, no network).
// It exports colliders for bodies, shootables for bullets, and spawn pads for the waves.
import * as THREE from 'three';
import { PALETTE, ARENA } from './config.js';

function paintedTexture(size, paint, repeatX, repeatY) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Concrete: mottled base, panel seams, a few stains. Deterministic noise so every run looks alike.
function concretePaint(ctx, size, base, seam) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 2600; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1 + rand() * 3.5;
    ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '0,0,0'},${0.012 + rand() * 0.03})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = seam;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  ctx.beginPath();
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.stroke();
  for (let i = 0; i < 7; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const grad = ctx.createRadialGradient(x, y, 2, x, y, 26 + rand() * 40);
    grad.addColorStop(0, 'rgba(0,0,0,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 70, y - 70, 140, 140);
  }
}

export function createStage(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const floorMap = paintedTexture(512, (ctx, size) => concretePaint(ctx, size, '#4b5962', 'rgba(18,24,28,0.45)'), 8, 8);
  const wallMap = paintedTexture(512, (ctx, size) => concretePaint(ctx, size, '#525f68', 'rgba(16,22,26,0.5)'), 6, 1.4);

  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: new THREE.Color('#e6edf1'), map: floorMap, roughness: 0.84, metalness: 0.14 }),
    wall: new THREE.MeshStandardMaterial({ color: new THREE.Color('#e2e9ee'), map: wallMap, roughness: 0.9, metalness: 0.06 }),
    trim: new THREE.MeshStandardMaterial({ color: new THREE.Color('#5d6a74'), roughness: 0.5, metalness: 0.6 }),
    crate: new THREE.MeshStandardMaterial({ color: new THREE.Color('#736b45'), roughness: 0.76, metalness: 0.1 }),
    crateDark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#4e4a33'), roughness: 0.8, metalness: 0.08 }),
    hazard: new THREE.MeshStandardMaterial({ color: new THREE.Color('#a8802f'), roughness: 0.6, metalness: 0.35 }),
    screen: new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c4a56'), emissive: new THREE.Color(PALETTE.glow), emissiveIntensity: 0.28, roughness: 0.5 }),
    lamp: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 2.6, roughness: 0.4 }),
    grime: new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b353d'), roughness: 0.95, metalness: 0.02 }),
  };

  const colliders = [];
  const shootables = [];
  const unit = new THREE.BoxGeometry(1, 1, 1);

  // Everything is one unit box scaled: one geometry, a dozen materials, minimal allocation.
  function block(w, h, d, x, y, z, material, solid = true, shadow = true) {
    const mesh = new THREE.Mesh(unit, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  const H = ARENA.half;
  const W = ARENA.wallHeight;

  // Floor slab plus a hazard-striped centre platform.
  block(H * 2 + 2, 0.5, H * 2 + 2, 0, -0.5, 0, materials.floor);
  block(9.0, 0.34, 9.0, 0, 0, 0, materials.grime, true);
  block(8.6, 0.06, 8.6, 0, 0.34, 0, materials.trim, false);
  for (let i = 0; i < 4; i += 1) {
    const side = i < 2 ? -1 : 1;
    const along = i % 2 === 0 ? 1 : -1;
    block(side * 4.28, 0.08, 2.2, side * 4.28, 0.36, along * (-2.6 + along * 0), materials.hazard, false);
  }

  // Perimeter walls with a metal trim band and emissive strip lights near the top.
  const wallDefs = [
    [H * 2 + 1.2, W, 0.7, 0, 0, -H],
    [H * 2 + 1.2, W, 0.7, 0, 0, H],
    [0.7, W, H * 2 + 1.2, -H, 0, 0],
    [0.7, W, H * 2 + 1.2, H, 0, 0],
  ];
  for (const [w, h, d, x, y, z] of wallDefs) {
    block(w, h, d, x, y, z, materials.wall);
    const alongX = w > d;
    block(alongX ? w : 1.0, 0.22, alongX ? 1.0 : d, x, h - 0.9, z, materials.trim, false);
    for (let i = -3; i <= 3; i += 1) {
      const offset = i * 4.4;
      const lx = alongX ? offset : x + (x < 0 ? 0.36 : -0.36);
      const lz = alongX ? z + (z < 0 ? 0.36 : -0.36) : offset;
      block(alongX ? 1.5 : 0.06, 0.12, alongX ? 0.06 : 1.5, lx, h - 1.35, lz, materials.lamp, false, false);
    }
  }

  // Cover: two crate stacks, long barriers, pillars and pipe runs, leaving three lanes.
  block(2.4, 1.5, 2.4, -7.4, 0, -4.2, materials.crate);
  block(1.7, 1.1, 1.7, -7.6, 1.5, -4.4, materials.crateDark);
  block(2.4, 1.5, 2.4, 7.4, 0, -4.2, materials.crate);
  block(1.7, 1.1, 1.7, 7.2, 1.5, -4.4, materials.crateDark);
  block(2.2, 1.3, 2.2, -8.0, 0, 5.8, materials.crateDark);
  block(2.2, 1.3, 2.2, 8.0, 0, 5.8, materials.crate);
  block(2.6, 1.0, 0.7, 0, 0, -8.6, materials.trim);
  block(0.7, 1.0, 2.6, -8.6, 0, 0, materials.trim);
  block(0.7, 1.0, 2.6, 8.6, 0, 0, materials.trim);
  block(1.0, 3.4, 1.0, -4.6, 0, -9.4, materials.trim);
  block(1.0, 3.4, 1.0, 4.6, 0, -9.4, materials.trim);
  block(1.0, 3.4, 1.0, -10.8, 0, 9.4, materials.trim);
  block(1.0, 3.4, 1.0, 10.8, 0, 9.4, materials.trim);
  block(1.1, 0.9, 3.2, -12.4, 0, -8.2, materials.hazard);
  block(1.1, 0.9, 3.2, 12.4, 0, 8.2, materials.hazard);
  // Low sandbag-ish plates flanking the middle lane, chest height only.
  block(3.2, 0.72, 0.55, -3.2, 0, 4.4, materials.crateDark);
  block(3.2, 0.72, 0.55, 3.2, 0, 4.4, materials.crateDark);

  // Barrels: cheap cylinders that break the box rhythm and give the yard a working look.
  const barrelGeometry = new THREE.CylinderGeometry(0.33, 0.33, 0.95, 12);
  const barrelTop = new THREE.CylinderGeometry(0.34, 0.34, 0.06, 12);
  const barrelSpots = [[-10.6, -2.4], [-9.9, -1.4], [11.2, -6.6], [10.5, -7.6], [-11.2, 11.0], [12.6, 2.2]];
  for (const [x, z] of barrelSpots) {
    const barrel = new THREE.Mesh(barrelGeometry, materials.hazard);
    barrel.position.set(x, 0.475, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    const lid = new THREE.Mesh(barrelTop, materials.trim);
    lid.position.set(x, 0.98, z);
    group.add(lid);
    colliders.push(new THREE.Box3().setFromObject(barrel));
    shootables.push(barrel);
  }

  // Overhead pipes and hanging cable trays for silhouette, above head height.
  const pipeGeometry = new THREE.CylinderGeometry(0.16, 0.16, H * 2, 8);
  for (let i = 0; i < 3; i += 1) {
    const pipe = new THREE.Mesh(pipeGeometry, materials.trim);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 4.5 + i * 0.34, -H + 1.6 + i * 1.2);
    group.add(pipe);
    const pipe2 = pipe.clone();
    pipe2.position.z = H - 1.6 - i * 1.2;
    group.add(pipe2);
  }

  // Wall screens: cool emissive panels that make the far wall read as a place, not a plane.
  for (const side of [-1, 1]) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.0), materials.screen);
    screen.position.set(side * (H - 0.42), 2.9, 0);
    screen.rotation.y = side * -Math.PI / 2;
    group.add(screen);
    const frame = new THREE.Mesh(unit, materials.trim);
    frame.scale.set(0.16, 2.3, 3.9);
    frame.position.set(side * (H - 0.3), 2.9, 0);
    group.add(frame);
    // Scanline slats: without them a flat plane reads as a rendering glitch at distance.
    for (let row = -3; row <= 3; row += 1) {
      const slat = new THREE.Mesh(unit, materials.grime);
      slat.scale.set(0.05, 0.05, 3.5);
      slat.position.set(side * (H - 0.44), 2.9 + row * 0.27, 0);
      group.add(slat);
    }
  }

  // A big painted sector mark on the floor so the middle of the arena has a focal point.
  const mark = new THREE.Mesh(new THREE.RingGeometry(2.5, 2.62, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.5 }));
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 0.41;
  group.add(mark);
  const markRing = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.46, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.32 }));
  markRing.rotation.x = -Math.PI / 2;
  markRing.position.y = 0.41;
  group.add(markRing);

  // Lamps: warm point lights in pairs plus their emissive housings.
  const lamps = [];
  for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9], [0, -13.6], [0, 13.6]]) {
    const housing = new THREE.Mesh(unit, materials.lamp);
    housing.scale.set(1.1, 0.12, 0.4);
    housing.position.set(x, 5.05, z);
    group.add(housing);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 46, 24, 1.8);
    light.position.set(x, 4.85, z);
    group.add(light);
    lamps.push(light);
  }

  // Lighting: cool sky fill, warm key with shadows, and a dim rim from behind.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#7d99aa'), new THREE.Color('#1b2328'), 2.6);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(new THREE.Color('#93a7b4'), 0.35);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(new THREE.Color('#eef6fb'), 3.1);
  key.position.set(10, 16, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(PALETTE.glow), 0.9);
  rim.position.set(-9, 7, -12);
  scene.add(rim);

  // Fog and a vertical gradient sky, so the top of the walls dissolves instead of ending.
  scene.fog = new THREE.FogExp2(new THREE.Color('#151d22'), 0.011);
  const skyGeometry = new THREE.SphereGeometry(90, 24, 16);
  const colors = [];
  const top = new THREE.Color('#101a21');
  const bottom = new THREE.Color('#070a0c');
  const position = skyGeometry.getAttribute('position');
  const temp = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const t = Math.max(0, position.getY(i) / 90);
    temp.copy(bottom).lerp(top, Math.pow(t, 0.5));
    colors.push(temp.r, temp.g, temp.b);
  }
  skyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  scene.add(sky);

  // Spawn pads around the perimeter, all sharing one pulse material. The wave module lights them.
  const padMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 0.15,
    transparent: true,
    opacity: 0.55,
    roughness: 0.5,
  });
  const padGeometry = new THREE.RingGeometry(0.55, 0.85, 24);
  const padPostGeometry = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6);
  const padPostMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a343d'), roughness: 0.6, metalness: 0.4 });
  const spawnPoints = [
    [-13.2, -12.6], [0, -13.4], [13.2, -12.6],
    [-13.6, 0], [13.6, 0],
    [-13.2, 12.4], [0, 13.4], [13.2, 12.4],
    [-6.2, -11.6], [6.2, -11.6], [-11.6, 7.4], [11.6, 7.4],
  ];
  const pads = [];
  for (const [x, z] of spawnPoints) {
    const padMaterialForOne = padMaterial.clone();
    const ring = new THREE.Mesh(padGeometry, padMaterialForOne);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    group.add(ring);
    const post = new THREE.Mesh(padPostGeometry, padPostMaterial);
    post.position.set(x, 1.1, z);
    group.add(post);
    pads.push({ ring, post, point: new THREE.Vector3(x, 0, z), glow: 0, material: padMaterialForOne });
  }

  function update(dt, time) {
    // Lamps breathe slightly, spawn pads pulse on their own phase, ring mark turns.
    for (let i = 0; i < lamps.length; i += 1) lamps[i].intensity = 44 + Math.sin(time * 1.7 + i * 1.3) * 4;
    for (let i = 0; i < pads.length; i += 1) {
      const pad = pads[i];
      pad.glow = Math.max(0, pad.glow - dt * 0.7);
      const pulse = 0.15 + pad.glow * 2.6 + Math.sin(time * 2.2 + i) * 0.05;
      pad.material.emissiveIntensity = pulse;
      pad.ring.scale.setScalar(1 + pad.glow * 0.12);
    }
    markRing.rotation.z = time * 0.12;
  }

  return {
    group,
    colliders,
    shootables,
    spawns: spawnPoints,
    pads,
    update,
    playerSpawn: new THREE.Vector3(0, 0, 9.0),
    // A shooter's eye height, used by enemies and by the capture poses.
    eyeHeight: 1.62,
  };
}