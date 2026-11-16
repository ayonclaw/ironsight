// The player body: acceleration, friction, gravity, sprint, crouch and jump, resolved as a box
// against the arena's colliders one axis at a time. It also owns health, regen and the camera's
// bob and trauma, so main.js only asks for a camera pose.
import * as THREE from 'three';
import { PLAYER, clamp, damp } from './config.js';

export function createPlayer(colliders, spawn) {
  const body = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: Math.PI,
    pitch: 0,
    eye: PLAYER.standEye,
    height: PLAYER.standHeight,
    onGround: true,
    crouching: false,
    sprinting: false,
    health: PLAYER.maxHealth,
    alive: true,
    hurt: 0,
    regenWait: 0,
    bob: 0,
    bobOffset: 0,
    stepPhase: 0,
    trauma: 0,
    shakeX: 0,
    shakeY: 0,
    shakeRoll: 0,
    landImpact: 0,
  };

  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function blocked(x, y, z, height, lift) {
    probe.min.set(x - PLAYER.radius, y + lift, z - PLAYER.radius);
    probe.max.set(x + PLAYER.radius, y + height - lift, z + PLAYER.radius);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0021) {
    if (!body.alive) return;
    body.yaw -= dx * sensitivity;
    body.pitch = clamp(body.pitch - dy * sensitivity, -1.45, 1.45);
  }

  function kick(pitchKick, yawKick) {
    body.pitch = clamp(body.pitch + pitchKick, -1.45, 1.45);
    body.yaw += yawKick;
  }

  function addTrauma(amount) {
    body.trauma = Math.min(1, body.trauma + amount);
  }

  function damage(amount) {
    if (!body.alive || amount <= 0) return false;
    body.health = Math.max(0, body.health - amount);
    body.hurt = Math.min(1, body.hurt + amount / 55);
    body.regenWait = PLAYER.regenDelay;
    addTrauma(Math.min(0.85, amount / 34));
    if (body.health === 0) body.alive = false;
    return !body.alive;
  }

  function heal(amount) {
    body.health = Math.min(PLAYER.maxHealth, body.health + amount);
  }

  function step(dt, keys, sfx) {
    const wantsCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantsCrouch && !body.crouching) {
      body.crouching = true;
      body.height = PLAYER.crouchHeight;
    } else if (!wantsCrouch && body.crouching) {
      if (!blocked(body.position.x, body.position.y, body.position.z, PLAYER.standHeight, 0.02)) {
        body.crouching = false;
        body.height = PLAYER.standHeight;
      }
    }
    body.eye = damp(body.eye, body.crouching ? PLAYER.crouchEye : PLAYER.standEye, 13, dt);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const wantsSprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && forward > 0 && !body.crouching;
    body.sprinting = wantsSprint && body.onGround && (forward !== 0 || strafe !== 0);

    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = body.crouching ? PLAYER.crouchSpeed : body.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const accel = body.onGround ? PLAYER.groundAccel : PLAYER.airAccel;
    const blend = Math.min(1, (accel * dt) / Math.max(0.5, speed));
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const friction = Math.max(0, 1 - PLAYER.friction * dt);
      body.velocity.x *= friction;
      body.velocity.z *= friction;
    }

    if (keys.has('Space') && body.onGround) {
      body.velocity.y = PLAYER.jumpSpeed;
      body.onGround = false;
      if (sfx) sfx.jump();
    }
    body.velocity.y -= PLAYER.gravity * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!blocked(nextX, body.position.y, body.position.z, body.height, 0.04)) {
      body.position.x = nextX;
    } else if (body.onGround && !blocked(nextX, body.position.y + 0.45, body.position.z, body.height, 0.04)) {
      // A kerb or the centre platform: step up rather than stop dead.
      body.position.x = nextX;
      body.position.y += 0.45;
    } else {
      body.velocity.x = 0;
    }
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!blocked(body.position.x, body.position.y, nextZ, body.height, 0.04)) {
      body.position.z = nextZ;
    } else if (body.onGround && !blocked(body.position.x, body.position.y + 0.45, nextZ, body.height, 0.04)) {
      body.position.z = nextZ;
      body.position.y += 0.45;
    } else {
      body.velocity.z = 0;
    }

    const wasGround = body.onGround;
    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = blocked(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    if (body.onGround && !wasGround) {
      body.landImpact = Math.min(1, Math.abs(body.velocity.y) / 9);
      if (sfx) sfx.land();
    }
    body.velocity.y = Math.max(-32, body.velocity.y);

    // Head bob and footsteps follow the distance actually walked, not the key state.
    const groundSpeed = Math.hypot(body.velocity.x, body.velocity.z);
    if (body.onGround && groundSpeed > 0.6) {
      body.stepPhase += dt * (body.sprinting ? 11.2 : 8.0);
      const phase = Math.floor(body.stepPhase / Math.PI);
      if (phase !== body.bob) {
        body.bob = phase;
        if (sfx) sfx.footstep();
      }
    } else {
      body.stepPhase = damp(body.stepPhase, Math.round(body.stepPhase / Math.PI) * Math.PI, 6, dt);
    }
    body.bobOffset = damp(body.bobOffset, body.onGround ? Math.sin(body.stepPhase) * PLAYER.bobAmount * Math.min(1, groundSpeed / 4) : 0, 14, dt);

    body.hurt = Math.max(0, body.hurt - dt * 1.35);
    if (body.health > 0 && body.health < PLAYER.maxHealth) {
      body.regenWait = Math.max(0, body.regenWait - dt);
      if (body.regenWait === 0) body.health = Math.min(PLAYER.maxHealth, body.health + PLAYER.regenRate * dt);
    }

    // Trauma decays, and the shake reads out of a cheap deterministic wobble.
    body.trauma = Math.max(0, body.trauma - dt * 1.8);
    const shake = body.trauma * body.trauma;
    const t = performance.now() * 0.001;
    body.shakeX = Math.sin(t * 47.3) * shake * 0.045;
    body.shakeY = Math.sin(t * 39.1 + 1.7) * shake * 0.04;
    body.shakeRoll = Math.sin(t * 31.7 + 0.4) * shake * 0.05;
  }

  return {
    state: body,
    step,
    look,
    kick,
    damage,
    heal,
    addTrauma,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    reset(x, z, yaw) {
      body.position.set(x, 0, z);
      body.velocity.set(0, 0, 0);
      body.yaw = yaw;
      body.pitch = 0;
      body.health = PLAYER.maxHealth;
      body.alive = true;
      body.hurt = 0;
      body.trauma = 0;
      body.crouching = false;
      body.height = PLAYER.standHeight;
      body.eye = PLAYER.standEye;
      body.regenWait = 0;
    },
  };
}
