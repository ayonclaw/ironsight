// The VK-7 rifle: a view model parented to the camera, a magazine, a reload with moving parts,
// an aiming mode, recoil animation and a muzzle flash. It owns the gun's numbers and visuals;
// main.js owns the ray, the damage and the world.
import * as THREE from 'three';
import { PALETTE, WEAPON, clamp, damp } from './config.js';

const HIP = new THREE.Vector3(0.245, -0.215, -0.48);
const ADS = new THREE.Vector3(0.0, -0.155, -0.36);
const MUZZLE = new THREE.Vector3(0.245, -0.105, -0.94);
const SCRATCH = new THREE.Vector3();

export function createWeapon(camera, sfx) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20272c'), roughness: 0.62, metalness: 0.55 });
  const mid = new THREE.MeshStandardMaterial({ color: new THREE.Color('#39444c'), roughness: 0.48, metalness: 0.62 });
  const light = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.4, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 2.4, roughness: 0.4 });

  const model = new THREE.Group();
  const parts = new THREE.Group();
  model.add(parts);
  camera.add(model);

  function box(w, h, d, x, y, z, material, parent = parts) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // Receiver and stock.
  box(0.082, 0.105, 0.46, 0, 0, 0.06, mid);
  box(0.072, 0.085, 0.2, 0, -0.012, 0.34, dark);
  box(0.05, 0.13, 0.07, 0, -0.085, 0.2, dark); // pistol grip
  // Handguard with vents, barrel and brake.
  box(0.07, 0.078, 0.34, 0, 0.004, -0.34, dark);
  for (let i = 0; i < 3; i += 1) box(0.076, 0.012, 0.03, 0, 0.028, -0.24 - i * 0.1, mid);
  box(0.028, 0.028, 0.36, 0, 0.012, -0.68, mid);
  box(0.042, 0.042, 0.075, 0, 0.012, -0.87, dark);
  // Optic: mount, tube, front glass, glowing dot.
  box(0.036, 0.03, 0.1, 0, 0.075, -0.04, dark);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.19, 12), mid);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.115, -0.06);
  parts.add(tube);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.031, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.glow), transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
  glass.position.set(0, 0.115, -0.155);
  parts.add(glass);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0038, 6, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }));
  dot.position.set(0, 0.115, -0.05);
  parts.add(dot);
  // Magazine: separate so a reload can drop it.
  const magazine = new THREE.Group();
  magazine.position.set(0, -0.075, -0.045);
  box(0.052, 0.16, 0.085, 0, -0.06, 0, dark, magazine);
  box(0.056, 0.02, 0.09, 0, -0.145, 0, accent, magazine);
  parts.add(magazine);
  // Bolt / charging handle that cycles when firing.
  const bolt = box(0.02, 0.02, 0.09, 0.05, 0.032, 0.02, light);
  // A faint amber strip along the handguard so the gun reads in the dark.
  box(0.004, 0.008, 0.2, 0.037, 0.012, -0.34, accent);

  model.traverse((child) => {
    if (child.isMesh) child.castShadow = false;
  });
  model.position.copy(HIP);
  model.scale.setScalar(0.9);

  // Muzzle flash: a painted radial sprite on crossed quads plus a small point light.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const flashCtx = flashCanvas.getContext('2d');
  const flashGradient = flashCtx.createRadialGradient(32, 32, 1, 32, 32, 31);
  flashGradient.addColorStop(0, 'rgba(255,255,240,1)');
  flashGradient.addColorStop(0.22, 'rgba(255,205,110,0.95)');
  flashGradient.addColorStop(0.55, 'rgba(255,140,40,0.42)');
  flashGradient.addColorStop(1, 'rgba(255,90,0,0)');
  flashCtx.fillStyle = flashGradient;
  flashCtx.fillRect(0, 0, 64, 64);
  const flashTexture = new THREE.CanvasTexture(flashCanvas);
  flashTexture.colorSpace = THREE.SRGBColorSpace;

  const flashGroup = new THREE.Group();
  flashGroup.position.copy(MUZZLE);
  const flashMaterial = new THREE.MeshBasicMaterial({
    map: flashTexture,
    color: new THREE.Color('#ffe6bd'),
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const flashGeometry = new THREE.PlaneGeometry(0.3, 0.3);
  const starA = new THREE.Mesh(flashGeometry, flashMaterial);
  const starB = new THREE.Mesh(flashGeometry, flashMaterial);
  starB.rotation.z = Math.PI / 2;
  const starC = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.11), flashMaterial);
  starC.rotation.z = Math.PI / 4;
  flashGroup.add(starA, starB, starC);
  flashGroup.visible = false;
  flashGroup.renderOrder = 20;
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 9, 2);
  flashLight.position.copy(MUZZLE).add(new THREE.Vector3(0, 0, 0.1));
  model.add(flashGroup, flashLight);

  const state = {
    mag: WEAPON.magSize,
    reserve: WEAPON.reserveMax,
    cooldown: 0,
    reloadLeft: 0,
    reloadTotal: WEAPON.reloadTime,
    flash: 0,
    kick: 0,
    boltCycle: 0,
    bloom: 0,
    aiming: 0,
    sprint: 0,
    swayX: 0,
    swayY: 0,
    shotsFired: 0,
  };

  function pullTrigger() {
    state.cooldown = WEAPON.fireGap;
    state.flash = WEAPON.muzzleSeconds;
    state.kick = 1;
    state.boltCycle = 1;
    state.bloom = Math.min(WEAPON.spreadMax, state.bloom + WEAPON.spreadPerShot);
    state.shotsFired += 1;
    flashGroup.rotation.z = Math.random() * Math.PI;
    flashGroup.scale.setScalar(0.75 + Math.random() * 0.5);
    if (sfx) sfx.shot();
  }

  function takeRound() {
    if (state.mag <= 0 || state.reloadLeft > 0) return false;
    state.mag -= 1;
    return true;
  }

  function reload() {
    if (state.reloadLeft > 0 || state.mag >= WEAPON.magSize || state.reserve <= 0) return false;
    state.reloadLeft = WEAPON.reloadTime;
    state.reloadTotal = WEAPON.reloadTime;
    state.kick = 0;
    if (sfx) sfx.reloadStart();
    return true;
  }

  function refill() {
    state.mag = WEAPON.magSize;
    state.reserve = WEAPON.reserveMax;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    state.bloom = 0;
    state.shotsFired = 0;
  }

  function addAmmo(rounds) {
    state.reserve = Math.min(WEAPON.reserveMax, state.reserve + rounds);
  }

  function spread(speed, airborne) {
    const moving = Math.min(1, speed / WEAPON.moveReference);
    const aimFactor = 1 - state.aiming * 0.55;
    return (WEAPON.spreadStill + moving * WEAPON.spreadMoving + state.bloom + (airborne ? 0.03 : 0)) * aimFactor;
  }

  function step(dt, options) {
    const { moving, sprinting, aiming, lookX, lookY, reloading } = options;
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick = damp(state.kick, 0, 16, dt);
    state.boltCycle = damp(state.boltCycle, 0, 22, dt);
    state.bloom = Math.max(0, state.bloom - dt * WEAPON.spreadRecover);
    state.aiming = damp(state.aiming, aiming ? 1 : 0, 16, dt);
    state.sprint = damp(state.sprint, sprinting ? 1 : 0, 9, dt);
    state.swayX = damp(state.swayX, clamp(-lookX * 0.00022, -0.035, 0.035), 12, dt);
    state.swayY = damp(state.swayY, clamp(-lookY * 0.00022, -0.03, 0.03), 12, dt);

    // Reload: the gun rolls down-left, the magazine drops out and a new one rises back in.
    let reloadTilt = 0;
    let reloadDrop = 0;
    let magY = 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = 1 - state.reloadLeft / state.reloadTotal;
      const curve = Math.sin(Math.min(1, progress) * Math.PI);
      reloadTilt = curve * 0.85;
      reloadDrop = curve * 0.14;
      magY = progress < 0.45 ? -Math.min(1, progress / 0.45) * 0.34 : -Math.max(0, 1 - (progress - 0.45) / 0.55) * 0.34;
      if (state.reloadLeft === 0) {
        const need = WEAPON.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        if (sfx) sfx.reloadEnd();
      }
    }

    const base = SCRATCH.copy(HIP).lerp(ADS, state.aiming);
    base.x += state.swayX;
    base.y += state.swayY - reloadDrop;
    base.z += state.kick * 0.075;
    base.y -= state.sprint * 0.075;
    base.z += state.sprint * 0.06;
    model.position.lerp(base, 1 - Math.exp(-24 * dt));

    model.rotation.set(
      state.kick * -0.11 + reloadTilt * 0.3 + state.sprint * 0.22,
      0.03 - state.aiming * 0.03 + state.swayX * 3,
      reloadTilt * -0.5 + state.sprint * -0.14,
    );
    magazine.position.y = magY;
    bolt.position.z = 0.02 + state.boltCycle * 0.055;

    flashGroup.visible = state.flash > 0;
    flashLight.intensity = state.flash > 0 ? 8 : 0;

    // Moving the mouse while aiming narrows the optic's glass a touch, a subtle ADS tell.
    glass.material.opacity = 0.10 + state.aiming * 0.14;
  }

  function muzzleWorld(target) {
    flashGroup.updateWorldMatrix(true, false);
    return target.copy(MUZZLE).applyMatrix4(model.matrixWorld);
  }

  // Used by the screenshot harness to hold a flash on a frozen frame.
  function showFlash() {
    state.flash = WEAPON.muzzleSeconds;
    flashGroup.visible = true;
    flashLight.intensity = 8;
    flashGroup.rotation.z = 0.6;
  }

  return {
    state,
    model,
    step,
    pullTrigger,
    takeRound,
    reload,
    refill,
    addAmmo,
    spread,
    muzzleWorld,
    showFlash,
    reloading() {
      return state.reloadLeft > 0;
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
  };
}