// The wave director: intermission, a telegraph on the pads, then staggered spawns. Count, health,
// speed and mix escalate, and every fourth wave is a heavier one. It only asks enemies to spawn;
// the arena's pads do the warning.
import { WAVES, ENEMY_TYPES, clamp } from './config.js';

export function createWaves({ enemies, stage, effects, sfx, player, random, onWaveStart, onWaveClear, onTelegraph }) {
  const state = {
    phase: 'idle',
    wave: 0,
    timer: 0,
    queue: [],
    spawnTimer: 0,
    total: 0,
    spawned: 0,
    kills: 0,
    sinceKill: 0,
  };

  function countFor(wave) {
    return Math.round(WAVES.firstWave + WAVES.growth * (wave - 1));
  }

  function pickType(wave, index) {
    const roll = random();
    if (wave >= 5 && wave % WAVES.bossEvery === 0 && index < Math.ceil(wave / 4)) return 'brute';
    if (wave >= 4 && roll > 0.86) return 'brute';
    if (wave >= 3 && roll > 0.64) return 'spitter';
    if (wave >= 2 && roll > 0.38) return 'sprinter';
    return 'drifter';
  }

  // Waves choose pads away from the player so nothing materialises in their face.
  function choosePads(count) {
    const px = player.state.position.x;
    const pz = player.state.position.z;
    const ranked = stage.pads
      .map((pad, index) => ({ index, distance: Math.hypot(pad.point.x - px, pad.point.z - pz) }))
      .sort((a, b) => b.distance - a.distance)
      .filter((entry) => entry.distance > 5.5);
    const chosen = [];
    for (let i = 0; i < count; i += 1) chosen.push(ranked[i % Math.max(1, ranked.length)].index);
    return chosen;
  }

  function beginWave() {
    state.wave += 1;
    state.phase = 'telegraph';
    state.timer = WAVES.telegraph;
    state.total = countFor(state.wave);
    state.spawned = 0;
    state.queue = [];
    state.sinceKill = 0;
    const pads = choosePads(Math.min(6, state.total));
    for (let i = 0; i < state.total; i += 1) {
      const padIndex = pads[i % pads.length];
      const type = pickType(state.wave, i);
      state.queue.push({ type, padIndex, dealt: false });
      const pad = stage.pads[padIndex];
      pad.glow = 1;
    }
    for (let i = 0; i < pads.length; i += 1) {
      const pad = stage.pads[pads[i]];
      effects.shockwave(pad.point.x, 0.06, pad.point.z, 0xff9a4a, 0.8);
      if (sfx) sfx.spawnTelegraph();
    }
    if (onTelegraph) onTelegraph(state.wave, pads);
    if (onWaveStart) onWaveStart(state.wave);
  }

  function spawnNext() {
    const alive = enemies.aliveCount();
    if (alive >= WAVES.maxAlive) return;
    const entry = state.queue.find((item) => !item.dealt);
    if (!entry) return;
    const pad = stage.pads[entry.padIndex];
    const healthScale = 1 + WAVES.healthScale * (state.wave - 1);
    const speedScale = Math.min(WAVES.speedCap, 1 + WAVES.speedScale * (state.wave - 1));
    const enemy = enemies.spawn(entry.type, pad.point.x + (random() - 0.5) * 1.1, pad.point.z + (random() - 0.5) * 1.1, healthScale, speedScale, state.wave);
    if (!enemy) return;
    entry.dealt = true;
    state.spawned += 1;
    pad.glow = 1;
    effects.shockwave(pad.point.x, 0.1, pad.point.z, 0xffb46a, 1.1);
    effects.sparkBurst(pad.point, { x: 0, y: 1, z: 0 }, 0xffa04a, 12, 2.6);
    if (sfx) sfx.spawnPop();
    const gap = Math.max(WAVES.spawnGapMin, WAVES.spawnGapStart - state.wave * 0.055);
    state.spawnTimer = gap * (0.7 + random() * 0.6);
  }

  function step(dt) {
    if (state.phase === 'idle') return;

    if (state.phase === 'intermission') {
      state.timer -= dt;
      if (state.timer <= 0) beginWave();
      return;
    }

    if (state.phase === 'telegraph') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'active';
        state.spawnTimer = 0;
      }
      return;
    }

    if (state.phase === 'active') {
      const pending = state.queue.some((item) => !item.dealt);
      if (pending) {
        state.spawnTimer -= dt;
        if (state.spawnTimer <= 0) spawnNext();
      } else if (enemies.aliveCount() === 0) {
        state.phase = 'intermission';
        state.timer = WAVES.intermission;
        const bonus = 50 + state.wave * 25;
        if (onWaveClear) onWaveClear(state.wave, bonus);
        if (sfx) sfx.waveClear();
      }
      state.sinceKill += dt;
    }
  }

  return {
    state,
    step,
    start() {
      state.wave = 0;
      state.phase = 'intermission';
      state.timer = 1.8;
      state.queue = [];
      state.total = 0;
      state.spawned = 0;
    },
    stop() {
      state.phase = 'idle';
      state.queue = [];
    },
    remaining() {
      return state.queue.filter((item) => !item.dealt).length + enemies.aliveCount();
    },
    waveTotal() {
      return state.total;
    },
    waveNumber() {
      return state.wave;
    },
    progress() {
      if (!state.total) return 0;
      return clamp((state.spawned - enemies.aliveCount()) / state.total, 0, 1);
    },
    label() {
      if (state.phase === 'idle') return 'STANDBY';
      if (state.phase === 'intermission') return `WAVE ${state.wave + 1} IN ${Math.max(1, Math.ceil(state.timer))}`;
      if (state.phase === 'telegraph') return `WAVE ${state.wave} INBOUND`;
      return `WAVE ${state.wave}`;
    },
  };
}