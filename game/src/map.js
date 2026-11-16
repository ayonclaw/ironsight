// The map: FOUNDRY 9, a dusk-shift casting yard built out of boxes and canvas textures so the
// whole thing ships as code. Layout, in one picture (x runs west→east, z runs north→south):
//
//        ┌──────────────────────── north lane ────────────────────────┐
//        │  ┌── NW block ──┐   north plaza (CINDER staging)  ┌─ NE ──┐  │
//        │  │  (alley)     │            │                   │(alley)│  │
//   west │  └──────────────┘      ┌─────┴─────┐             └───────┘  │ east
//   lane │       west plaza       │  SITE A   │      east plaza        │ lane
//        │  ┌── SW block ──┐      └─────┬─────┘      ┌─ SE ──┐         │
//        │  │  (alley)     │   south plaza (CT spawn) │(alley)│         │
//        └──────────────────────── south lane ────────────────────────┘
//
// One site with four doors, four corner blocks with covered alleys through them, and a perimeter
// lane that lets either side flank all the way around. Everything solid is in `solids` and every
// wall, crate and barrel is one of those boxes: the same list feeds collision, bullet tracing and
// the navigation grid, so what you see is exactly what you can shoot and walk into.

import * as THREE from 'three';
import { PALETTE, clamp } from './config.js';
import { box } from './physics.js';

const SITE_HALF = 6; // site interior spans -5..5 on both axes
const BLOCK = { near: 10, far: 18 }; // corner blocks sit between 10 m and 18 m out
const LANE = 22; // perimeter lane centre line
const BOUND = { x: 24, z: 22 };
const WALL_H = 4.6;

// ---------------------------------------------------------------------------------------------
// procedural textures: small canvases, drawn once, reused by every material
// ---------------------------------------------------------------------------------------------

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function noiseFill(ctx, size, base, spread, alpha) {
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const n = (Math.random() - 0.5) * spread;
      data[i] = clamp(data[i] + n, 0, 255);
      data[i + 1] = clamp(data[i + 1] + n, 0, 255);
      data[i + 2] = clamp(data[i + 2] + n, 0, 255);
      data[i + 3] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function texture(render, size = 512, repeat = 1) {
  const c = canvas(size);
  render(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Concrete: poured slabs with seams, aggregate speckle and a few long stains.
function concreteTexture(repeat) {
  return texture((ctx, size) => {
    ctx.fillStyle = PALETTE.concrete;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 9000; i += 1) {
      const g = 40 + Math.random() * 120;
      ctx.fillStyle = `rgba(${g},${g + 4},${g},${0.05 + Math.random() * 0.13})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    // slab seams every quarter
    ctx.strokeStyle = 'rgba(20,24,22,.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i += 1) {
      const p = (i * size) / 4;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }
    // rust-streak stains
    for (let i = 0; i < 12; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const w = 20 + Math.random() * 90;
      const h = 10 + Math.random() * 40;
      const grd = ctx.createRadialGradient(x, y, 1, x, y, w);
      grd.addColorStop(0, 'rgba(52,38,28,.3)');
      grd.addColorStop(1, 'rgba(52,38,28,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(x - w, y - h, w * 2, h * 2);
    }
  }, 512, repeat);
}

// Painted steel: ribbed panels, rivet rows, chipped paint down to bare metal.
function metalTexture(repeat) {
  return texture((ctx, size) => {
    ctx.fillStyle = PALETTE.metal;
    ctx.fillRect(0, 0, size, size);
    noiseFill(ctx, size, 0, 26, 255);
    for (let i = 0; i < size; i += 64) {
      ctx.fillStyle = 'rgba(10,14,16,.32)';
      ctx.fillRect(i, 0, 3, size);
      ctx.fillStyle = 'rgba(190,205,210,.09)';
      ctx.fillRect(i + 3, 0, 2, size);
    }
    ctx.fillStyle = 'rgba(30,34,36,.5)';
    for (let x = 32; x < size; x += 64) {
      for (let y = 18; y < size; y += 96) {
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y + 48, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (let i = 0; i < 26; i += 1) {
      ctx.fillStyle = `rgba(120,74,51,${0.14 + Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 8 + Math.random() * 40, 4 + Math.random() * 22);
    }
  }, 512, repeat);
}

// Crates: dark composite with strap bands and a stencilled code.
function crateTexture(repeat) {
  return texture((ctx, size) => {
    ctx.fillStyle = '#4a4634';
    ctx.fillRect(0, 0, size, size);
    noiseFill(ctx, size, 0, 34, 255);
    ctx.fillStyle = 'rgba(28,26,20,.55)';
    ctx.fillRect(0, 0, size, 10);
    ctx.fillRect(0, size - 10, size, 10);
    ctx.fillStyle = 'rgba(24,22,18,.7)';
    for (let i = 0; i < size; i += 64) ctx.fillRect(i, 0, 6, size);
    ctx.strokeStyle = 'rgba(214,220,214,.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, size - 16, size - 16);
    ctx.fillStyle = 'rgba(226,232,226,.28)';
    ctx.font = `bold ${size * 0.11}px ui-monospace, monospace`;
    ctx.fillText('F9', 22, size * 0.55);
    ctx.fillText('LOT 41', 22, size * 0.72);
  }, 256, repeat);
}

// Hazard chevrons for door frames and kerbs — reads as a tactical site at a glance.
function hazardTexture(repeat) {
  return texture((ctx, size) => {
    ctx.fillStyle = '#221f18';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#c79b33';
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    for (let i = -size; i < size; i += 48) ctx.fillRect(i, -size, 22, size * 2);
    ctx.restore();
    noiseFill(ctx, size, 0, 30, 255);
  }, 256, repeat);
}

// The site marking: a painted ring with "A" and weathered stripes.
function siteTexture() {
  return texture((ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(232,180,60,.72)';
    ctx.lineWidth = size * 0.035;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = size * 0.014;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.31, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(238,190,70,.85)';
    ctx.font = `bold ${size * 0.44}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', size / 2, size * 0.47);
    ctx.font = `600 ${size * 0.1}px ui-monospace, monospace`;
    ctx.fillText('SITE A', size / 2, size * 0.75);
    // scuffs so it is paint, not a decal from a clean editor
    for (let i = 0; i < 200; i += 1) {
      ctx.clearRect(size * 0.2 + Math.random() * size * 0.6, size * 0.2 + Math.random() * size * 0.6, 5, 3);
    }
  }, 512, 1);
}

// Sky dome: a dusk gradient with a warm band at the horizon.
function skyTexture() {
  const c = canvas(64);
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#0d1720');
  grd.addColorStop(0.55, '#22333d');
  grd.addColorStop(0.82, '#3c4a4a');
  grd.addColorStop(1, '#6b5a44');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft round shadow blob used to bake contact occlusion under crates and columns.
function blobTexture() {
  const c = canvas(128);
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,.62)');
  grd.addColorStop(0.55, 'rgba(0,0,0,.28)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------------------------

export function createMap(scene) {
  const group = new THREE.Group();
  group.name = 'foundry';
  scene.add(group);

  const solids = [];
  const lampLights = [];
  const glowMaterials = [];

  const tex = {
    concrete: concreteTexture(8),
    floor: concreteTexture(26),
    metal: metalTexture(4),
    crate: crateTexture(1),
    hazard: hazardTexture(2),
    site: siteTexture(),
    blob: blobTexture(),
  };

  const mats = {
    floor: new THREE.MeshStandardMaterial({ map: tex.floor, color: '#9aa09a', roughness: 0.92, metalness: 0.08 }),
    wall: new THREE.MeshStandardMaterial({ map: tex.concrete, color: '#a6aba4', roughness: 0.9, metalness: 0.05 }),
    block: new THREE.MeshStandardMaterial({ map: tex.metal, color: '#a8b2b4', roughness: 0.74, metalness: 0.12 }),
    trim: new THREE.MeshStandardMaterial({ map: tex.metal, color: '#7d888b', roughness: 0.58, metalness: 0.24 }),
    crate: new THREE.MeshStandardMaterial({ map: tex.crate, color: '#c8c6b4', roughness: 0.86, metalness: 0.06 }),
    hazard: new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.8, metalness: 0.18 }),
    barrel: new THREE.MeshStandardMaterial({ color: '#8a5735', roughness: 0.72, metalness: 0.18 }),
    catwalk: new THREE.MeshStandardMaterial({ color: '#4a5458', roughness: 0.7, metalness: 0.22 }),
    dark: new THREE.MeshStandardMaterial({ color: '#222a2c', roughness: 0.95 }),
  };

  const unit = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(0.42, 0.42, 0.92, 12);

  function addBox(x0, z0, x1, z1, height, material, base = 0, solid = true) {
    const b = box(x0, z0, x1, z1, height, base);
    const mesh = new THREE.Mesh(unit, material || mats.wall);
    mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    mesh.scale.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      b.mesh = mesh;
      solids.push(b);
    }
    return b;
  }

  // A painted kerb / trim strip that is never solid: it only dresses an edge.
  function trim(x0, z0, x1, z1, y, height, material) {
    const mesh = new THREE.Mesh(unit, material || mats.trim);
    mesh.position.set((x0 + x1) / 2, y + height / 2, (z0 + z1) / 2);
    mesh.scale.set(Math.abs(x1 - x0), height, Math.abs(z1 - z0));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Contact shadow: a blob quad just above the floor, multiplying nothing but depth.
  function contact(x, z, w, d) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: tex.blob, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, opacity: 0.85 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.015, z);
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  // ---- floor and sky -------------------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(BOUND.x * 2 + 4, BOUND.z * 2 + 4), mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 20),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  group.add(dome);

  // ---- perimeter ----------------------------------------------------------------------------
  const T = 1.2;
  addBox(-BOUND.x, -BOUND.z, BOUND.x, -BOUND.z + T, 7.2, mats.wall);
  addBox(-BOUND.x, BOUND.z - T, BOUND.x, BOUND.z, 7.2, mats.wall);
  addBox(-BOUND.x, -BOUND.z, -BOUND.x + T, BOUND.z, 7.2, mats.wall);
  addBox(BOUND.x - T, -BOUND.z, BOUND.x, BOUND.z, 7.2, mats.wall);
  // capping trim so the top edge reads as a parapet, not a cut-off plane
  trim(-BOUND.x, -BOUND.z, BOUND.x, -BOUND.z + 0.35, 7.2, 0.35);
  trim(-BOUND.x, BOUND.z - 0.35, BOUND.x, BOUND.z, 7.2, 0.35);

  // ---- site A: four walls, four doors, hazard frames -----------------------------------------
  const S = SITE_HALF + 0.5; // wall outer face at ±6.5, inner face at ±5.5
  addBox(-S, -S, -2, -S + 1, WALL_H, mats.wall); // north wall, west of door
  addBox(2, -S, S, -S + 1, WALL_H, mats.wall); // north wall, east of door
  addBox(-S, S - 1, -2, S, WALL_H, mats.wall); // south wall
  addBox(2, S - 1, S, S, WALL_H, mats.wall);
  addBox(-S, -S + 1, -S + 1, -2, WALL_H, mats.wall); // west wall
  addBox(-S, 2, -S + 1, S - 1, WALL_H, mats.wall);
  addBox(S - 1, -S + 1, S, -2, WALL_H, mats.wall); // east wall
  addBox(S - 1, 2, S, S - 1, WALL_H, mats.wall);
  // lintels over the four doors (overhead geometry: walk under, shoot under)
  addBox(-2, -S, 2, -S + 1, WALL_H - 2.65, mats.wall, 2.65);
  addBox(-2, S - 1, 2, S, WALL_H - 2.65, mats.wall, 2.65);
  addBox(-S, -2, -S + 1, 2, WALL_H - 2.65, mats.wall, 2.65);
  addBox(S - 1, -2, S, 2, WALL_H - 2.65, mats.wall, 2.65);
  // hazard paint on each door frame
  trim(-2.05, -S - 0.02, -1.75, -S + 1.02, 0, 0.55, mats.hazard);
  trim(1.75, -S - 0.02, 2.05, -S + 1.02, 0, 0.55, mats.hazard);
  trim(-1.75, -S - 0.02, 1.75, -S + 1.02, 3.0, 0.22, mats.hazard);

  // the pad: a raised 0.18 m deck the charge sits on, with the painted ring on top
  addBox(-4, -4, 4, 4, 0.18, mats.catwalk, 0, true);
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 8.4),
    new THREE.MeshStandardMaterial({ map: tex.site, transparent: true, roughness: 0.8, metalness: 0.1 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.2, 0);
  ring.receiveShadow = true;
  group.add(ring);

  // cover inside the site: low crates you can crouch behind and one tall stack that breaks the door
  addBox(-4.6, -2.0, -2.8, 0.6, 1.15, mats.crate);
  addBox(2.7, 1.4, 4.7, 3.2, 1.15, mats.crate);
  addBox(-1.2, -5.4, 1.8, -4.2, 2.35, mats.crate);
  addBox(-4.9, 3.1, -3.4, 4.9, 2.35, mats.crate);
  contact(-3.7, -0.7, 3.4, 4.2);
  contact(3.7, 2.3, 3.4, 3.4);
  contact(0.3, -4.8, 4.2, 2.6);
  contact(-4.1, 4.0, 2.6, 2.6);

  // barrels in the site's north-east corner
  function barrel(x, z) {
    const mesh = new THREE.Mesh(cylinder, mats.barrel);
    mesh.position.set(x, 0.46, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    solids.push({ x0: x - 0.42, x1: x + 0.42, y0: 0, y1: 0.92, z0: z - 0.42, z1: z + 0.42, mat: 'barrel' });
    contact(x, z, 1.6, 1.6);
  }
  barrel(4.3, -4.2);
  barrel(4.9, -3.4);

  // ---- four corner blocks, each split by a covered alley ------------------------------------
  const blocks = [
    { x0: -BLOCK.far, x1: -BLOCK.near, z0: -BLOCK.far, z1: -BLOCK.near, alley: 'z' },
    { x0: BLOCK.near, x1: BLOCK.far, z0: -BLOCK.far, z1: -BLOCK.near, alley: 'z' },
    { x0: -BLOCK.far, x1: -BLOCK.near, z0: BLOCK.near, z1: BLOCK.far, alley: 'z' },
    { x0: BLOCK.near, x1: BLOCK.far, z0: BLOCK.near, z1: BLOCK.far, alley: 'z' },
  ];
  const ALLEY = 2.6;
  for (const blk of blocks) {
    const mid = (blk.z0 + blk.z1) / 2;
    const a0 = mid - ALLEY / 2;
    const a1 = mid + ALLEY / 2;
    // two solid halves with a roofed passage between them
    addBox(blk.x0, blk.z0, blk.x1, a0, 6.2, mats.block);
    addBox(blk.x0, a1, blk.x1, blk.z1, 6.2, mats.block);
    // the alley roof (2.9 m clearance) and its frame
    addBox(blk.x0, a0, blk.x1, a1, 6.2 - 3.0, mats.trim, 3.0, false);
    trim(blk.x0, a0 - 0.12, blk.x0 + 0.3, a1 + 0.12, 0, 3.0, mats.hazard);
    trim(blk.x1 - 0.3, a0 - 0.12, blk.x1, a1 + 0.12, 0, 3.0, mats.hazard);
    contact((blk.x0 + blk.x1) / 2, a0, Math.abs(blk.x1 - blk.x0), 1.2);
    contact((blk.x0 + blk.x1) / 2, a1, Math.abs(blk.x1 - blk.x0), 1.2);
    // roofline units: vents and a sign band, all non-solid
    trim(blk.x0 + 1.2, blk.z0 + 1.2, blk.x0 + 2.4, blk.z0 + 2.4, 6.2, 0.6, mats.trim);
    trim(blk.x1 - 2.6, blk.z1 - 2.2, blk.x1 - 1.4, blk.z1 - 1.0, 6.2, 0.5, mats.trim);
  }

  // ---- crates and cover around the map -------------------------------------------------------
  const crates = [
    // north plaza: CINDER staging cover
    [-3.4, -11.8, -1.2, -9.9, 1.2], [2.2, -12.4, 4.6, -10.6, 2.4], [6.6, -11.2, 8.4, -9.6, 1.2],
    // south plaza: WARDEN hold
    [-1.4, 10.4, 1.2, 12.2, 1.2], [-7.4, 11.6, -5.2, 13.4, 2.4], [4.8, 12.0, 6.6, 13.8, 1.2],
    // east plaza
    [8.6, -2.4, 10.2, -0.6, 1.2], [8.4, 4.2, 10.0, 5.8, 2.4],
    // west plaza
    [-10.2, -3.4, -8.6, -1.6, 1.2], [-10.0, 3.6, -8.4, 5.4, 1.2],
    // north lane
    [-12.4, -19.4, -9.6, -18.2, 1.2], [3.2, -19.8, 6.4, -18.4, 2.4], [14.0, -20.2, 16.2, -18.6, 1.2],
    // south lane
    [-15.8, 18.6, -13.2, 20.1, 1.2], [0.4, 19.2, 3.0, 20.6, 1.2], [12.6, 18.4, 15.0, 20.2, 2.4],
    // west lane
    [-22.4, -8.2, -20.6, -5.6, 1.2], [-22.2, 6.4, -20.4, 8.2, 2.4],
    // east lane
    [20.6, -7.8, 22.4, -5.2, 1.2], [20.4, 7.0, 22.2, 9.0, 2.4],
    // corners of the perimeter lane
    [-22.2, -21.0, -19.8, -19.2, 1.2], [19.8, -21.2, 22.2, -19.4, 1.2],
  ];
  for (const [x0, z0, x1, z1, h] of crates) {
    addBox(x0, z0, x1, z1, h, mats.crate);
    contact((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) + 1.4, Math.abs(z1 - z0) + 1.4);
  }

  // long cover walls in the plazas: waist-high concrete you can shoot over when standing
  addBox(-9.4, -6.2, -8.8, 1.8, 1.05, mats.wall);
  addBox(8.8, -1.6, 9.4, 6.0, 1.05, mats.wall);
  addBox(-2.0, 9.2, 5.2, 9.8, 1.05, mats.wall);
  addBox(-13.2, -6.6, -12.6, -0.4, 1.05, mats.wall);

  // barrels scattered where fights happen
  barrel(-7.2, -9.2);
  barrel(9.2, 9.0);
  barrel(-11.4, 9.4);

  // ---- lamps, pipes and the site floodlights -------------------------------------------------
  function lamp(x, z, height, color, power) {
    const housing = new THREE.Mesh(unit, mats.dark);
    housing.position.set(x, height, z);
    housing.scale.set(0.5, 0.28, 0.5);
    group.add(housing);
    const bulbMat = new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color), emissiveIntensity: 3.2, roughness: 0.4,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), bulbMat);
    bulb.position.set(x, height - 0.2, z);
    group.add(bulb);
    glowMaterials.push(bulbMat);
    const light = new THREE.PointLight(new THREE.Color(color), power, 26, 1.7);
    light.position.set(x, height - 0.35, z);
    group.add(light);
    lampLights.push({ light, base: power, phase: Math.random() * 6 });
    return light;
  }

  lamp(0, -8.6, 5.4, '#ffb15e', 26); // north door
  lamp(0, 8.6, 5.4, '#ffb15e', 24); // south door
  lamp(-8.6, 0, 5.4, '#ffa54e', 18); // west door
  lamp(8.6, 0, 5.4, '#ffa54e', 18); // east door
  lamp(0, -16.5, 6.0, '#8fd2ff', 16); // north plaza cool flood
  lamp(0, 16.5, 6.0, '#8fd2ff', 16); // south plaza
  lamp(-20, 0, 5.6, '#ffc070', 14); // west lane
  lamp(20, 0, 5.6, '#ffc070', 14); // east lane

  // overhead pipes crossing the site and the plazas (non-solid, they sell the scale)
  const pipeGeo = new THREE.CylinderGeometry(0.14, 0.14, 1, 8, 1, true);
  function pipe(x0, y, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const mesh = new THREE.Mesh(pipeGeo, mats.trim);
    mesh.scale.set(1, len, 1);
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    mesh.rotation.z = Math.PI / 2;
    mesh.rotation.y = Math.atan2(z1 - z0, x1 - x0);
    group.add(mesh);
  }
  pipe(-20, 5.0, -14.5, 20, -14.5);
  pipe(-20, 5.4, 14.5, 20, 14.5);
  pipe(-13.5, 4.2, -9, -13.5, 9);
  pipe(13.5, 4.4, -9, 13.5, 9);

  // ---- lighting ------------------------------------------------------------------------------
  scene.fog = new THREE.FogExp2(new THREE.Color(PALETTE.fog), 0.0125);
  const hemi = new THREE.HemisphereLight(new THREE.Color('#8fb4cc'), new THREE.Color('#3a2a1e'), 1.5);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(new THREE.Color('#6b7f8a'), 0.75);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffc08a'), 2.1);
  sun.position.set(-26, 34, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0016;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // cool fill from the opposite side so shadowed faces still read blue, not black
  const fill = new THREE.DirectionalLight(new THREE.Color('#5f9fc6'), 1.05);
  fill.position.set(28, 18, 26);
  scene.add(fill);

  // ---- spawns --------------------------------------------------------------------------------
  const spawns = {
    warden: [
      { x: -21.2, z: 19.4, yaw: Math.PI * 0.62 },
      { x: -19.4, z: 18.6, yaw: Math.PI * 0.7 },
      { x: -17.2, z: 19.8, yaw: Math.PI * 0.78 },
      { x: -21.4, z: 17.0, yaw: Math.PI * 0.55 },
      { x: -15.2, z: 19.0, yaw: Math.PI * 0.85 },
    ],
    cinder: [
      { x: 21.2, z: -19.4, yaw: -Math.PI * 0.38 },
      { x: 19.4, z: -18.6, yaw: -Math.PI * 0.3 },
      { x: 17.2, z: -19.8, yaw: -Math.PI * 0.22 },
      { x: 21.4, z: -17.0, yaw: -Math.PI * 0.45 },
      { x: 15.2, z: -19.0, yaw: -Math.PI * 0.15 },
    ],
  };

  // Where the bots want to be: defensive holds around the site, attacking points inside it, and
  // the routes that connect the lanes. Hand-placed so the AI reads as intent, not as wandering.
  const holds = {
    warden: [
      { x: -1.0, z: 3.6, yaw: -Math.PI / 2, look: { x: 0, z: -8 } },
      { x: 4.2, z: -2.6, yaw: Math.PI, look: { x: -8, z: 0 } },
      { x: -3.2, z: -3.0, yaw: Math.PI / 2, look: { x: 8, z: 0 } },
      { x: 1.4, z: 9.4, yaw: 0, look: { x: 0, z: 6 } },
      { x: -9.4, z: 1.2, yaw: Math.PI / 2, look: { x: 0, z: 0 } },
    ],
    cinder: [
      { x: 0.8, z: -1.4, yaw: Math.PI, look: { x: 0, z: 8 } },
      { x: -1.6, z: 2.2, yaw: Math.PI / 2, look: { x: -8, z: 0 } },
      { x: 4.4, z: 0.4, yaw: -Math.PI / 2, look: { x: 8, z: 0 } },
      { x: 2.0, z: -4.6, yaw: 0, look: { x: 0, z: -8 } },
      { x: -8.8, z: -1.0, yaw: Math.PI / 2, look: { x: 0, z: 0 } },
    ],
  };

  // Staging points the bots path through on the way in, per side, so they take lanes rather than
  // beeline across the map.
  const staging = {
    warden: [
      { x: -2.0, z: 12.6 }, { x: 2.6, z: 11.0 }, { x: 6.4, z: 8.0 }, { x: -6.4, z: 8.4 }, { x: -12.0, z: 12.0 },
    ],
    cinder: [
      { x: 2.4, z: -12.4 }, { x: -2.4, z: -11.6 }, { x: -6.0, z: -8.4 }, { x: 6.6, z: -8.2 }, { x: 10.6, z: -12.4 },
    ],
  };

  const site = { x: 0, z: 0, radius: 4.4, pad: 4.0 };
  const plantSpot = { x: 0.4, z: -0.6 };

  // ---- the breach charge ---------------------------------------------------------------------
  // A physical object, not a marker: a case with straps, a blinking LED and its own little light,
  // so "planted" is something you can see across the site and walk up to.
  const chargeGroup = new THREE.Group();
  chargeGroup.position.set(plantSpot.x, 0.18, plantSpot.z);
  chargeGroup.visible = false;
  group.add(chargeGroup);
  const caseMat = new THREE.MeshStandardMaterial({ color: '#3a4034', roughness: 0.78, metalness: 0.15 });
  const strapMat = new THREE.MeshStandardMaterial({ color: '#20241f', roughness: 0.9 });
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.2, 0.36), caseMat);
  caseMesh.position.y = 0.1;
  caseMesh.castShadow = true;
  chargeGroup.add(caseMesh);
  for (const x of [-0.16, 0.16]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.21, 0.38), strapMat);
    strap.position.set(x, 0.1, 0);
    chargeGroup.add(strap);
  }
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.14), strapMat);
  pad.position.set(0, 0.21, 0);
  pad.rotation.z = 0.2;
  chargeGroup.add(pad);
  const ledMat = new THREE.MeshStandardMaterial({ color: '#ff3a22', emissive: new THREE.Color('#ff3a22'), emissiveIntensity: 2.6, roughness: 0.4 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), ledMat);
  led.position.set(0.12, 0.22, 0.12);
  chargeGroup.add(led);
  const chargeLight = new THREE.PointLight(new THREE.Color('#ff3a22'), 0, 7, 2);
  chargeLight.position.set(0.12, 0.3, 0.12);
  chargeGroup.add(chargeLight);
  // a chalk X on the floor under it so the defuse spot is obvious even in the dark
  const chalk = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.62, 24),
    new THREE.MeshBasicMaterial({ color: '#ff7a42', transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
  );
  chalk.rotation.x = -Math.PI / 2;
  chalk.position.y = 0.008;
  chargeGroup.add(chalk);

  const api = {
    group, solids, spawns, holds, staging, site, plantSpot, bounds: BOUND,
    lamps: lampLights,
    floorY: 0,
    sun,
    // Animated dressing: lamp flicker is subtle, but a static screenshot still reads as "lit".
    charge: { group: chargeGroup, led: ledMat, light: chargeLight },
    update(time, charge) {
      for (let i = 0; i < lampLights.length; i += 1) {
        const l = lampLights[i];
        const flicker = 1 + Math.sin(time * 2.3 + l.phase) * 0.03 + (Math.sin(time * 17 + l.phase) > 0.985 ? -0.18 : 0);
        l.light.intensity = l.base * flicker;
      }
      // The charge blinks faster as its fuse burns down: the audio cue has a visual twin.
      const armed = charge && charge.planted && !charge.defused;
      chargeGroup.visible = !!armed;
      if (armed) {
        const rate = 2.2 + (1 - Math.min(1, charge.fuseLeft / 40)) * 7;
        const on = Math.sin(time * rate * Math.PI) > 0;
        ledMat.emissiveIntensity = on ? 3.4 : 0.25;
        chargeLight.intensity = on ? 6 : 0.4;
      } else {
        chargeLight.intensity = 0;
      }
    },
    inSite(x, z, pad = 0) {
      return Math.abs(x - site.x) <= site.radius + pad && Math.abs(z - site.z) <= site.radius + pad;
    },
  };
  return api;
}

export { WALL_H, SITE_HALF, BOUND, LANE };
