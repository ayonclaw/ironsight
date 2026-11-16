// Every sound in IRONSIGHT is synthesised at runtime with WebAudio: filtered noise bursts for
// gunfire and impacts, tuned oscillators for the UI, a slow filtered noise bed for the yard.
// No audio files, no network, and every call is a no-op until the browser gives us a context
// (which happens on the first click, as autoplay rules require), so headless capture still works.

export function createAudio() {
  let ctx = null;
  let master = null;
  let bus = null;
  let noise = null;
  let muted = false;
  let ambientStarted = false;

  function boot() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    // A gentle master chain: compressor for the loud moments, then a limiter-ish gain.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(comp);
    comp.connect(ctx.destination);

    // Music/ambience bus, kept under the effects.
    bus = ctx.createGain();
    bus.gain.value = 0.5;
    bus.connect(master);

    const length = Math.floor(ctx.sampleRate * 2);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.36 + white * 0.64;
      data[i] = last;
    }
    return ctx;
  }

  const now = () => (ctx ? ctx.currentTime : 0);

  function noiseBurst({ gain = 0.3, duration = 0.12, type = 'bandpass', frequency = 1800, q = 1, attack = 0.002, sweep = 0, delay = 0, destination = master }) {
    if (!ctx || muted) return;
    const t = now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(Math.max(40, frequency), t);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + sweep), t + duration);
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(env);
    env.connect(destination);
    src.start(t, Math.random() * 1.4);
    src.stop(t + duration + 0.03);
  }

  function tone({ type = 'sine', gain = 0.2, duration = 0.18, from = 440, to = 220, attack = 0.004, delay = 0, destination = master }) {
    if (!ctx || muted) return;
    const t = now() + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env);
    env.connect(destination);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  // A slow, filtered bed: wind through a foundry yard, plus a distant electrical hum. Loops for
  // as long as the page lives, so the map never sounds like a silent room.
  function startAmbient() {
    if (!ctx || ambientStarted || muted) return;
    ambientStarted = true;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.6;
    const env = ctx.createGain();
    env.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.028;
    lfo.connect(lfoGain);
    lfoGain.connect(env.gain);
    src.connect(lp);
    lp.connect(env);
    env.connect(bus);
    src.start();
    lfo.start();

    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 48;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 110;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.014;
    hum.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(bus);
    hum.start();
  }

  return {
    boot() {
      const c = boot();
      startAmbient();
      return c;
    },
    isMuted() { return muted; },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.6;
      return muted;
    },
    resume() {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },

    // ---- weapons ------------------------------------------------------------------------------
    shot(key) {
      if (!ctx) return;
      const vary = 0.92 + Math.random() * 0.16;
      if (key === 'halberd') {
        noiseBurst({ gain: 0.4, duration: 0.15, frequency: 1700 * vary, q: 0.7, sweep: -1100 });
        noiseBurst({ gain: 0.2, duration: 0.05, type: 'highpass', frequency: 4200, q: 0.6 });
        tone({ type: 'triangle', gain: 0.28, duration: 0.14, from: 150 * vary, to: 42 });
      } else if (key === 'vesper') {
        noiseBurst({ gain: 0.28, duration: 0.09, frequency: 2600 * vary, q: 0.9, sweep: -1600 });
        tone({ type: 'square', gain: 0.12, duration: 0.06, from: 220 * vary, to: 80 });
      } else if (key === 'breakwater') {
        noiseBurst({ gain: 0.5, duration: 0.32, type: 'lowpass', frequency: 1600, q: 0.7, sweep: -1200 });
        tone({ type: 'triangle', gain: 0.34, duration: 0.22, from: 120, to: 34 });
      } else {
        noiseBurst({ gain: 0.3, duration: 0.11, frequency: 2200 * vary, q: 0.8, sweep: -1400 });
        tone({ type: 'triangle', gain: 0.2, duration: 0.1, from: 180 * vary, to: 52 });
      }
    },
    dryFire() {
      noiseBurst({ gain: 0.1, duration: 0.05, type: 'highpass', frequency: 2800 });
      tone({ type: 'square', gain: 0.04, duration: 0.04, from: 800, to: 500 });
    },
    reloadStart() {
      noiseBurst({ gain: 0.13, duration: 0.1, type: 'lowpass', frequency: 900 });
      tone({ type: 'square', gain: 0.045, duration: 0.06, from: 300, to: 170, delay: 0.02 });
    },
    reloadEnd() {
      noiseBurst({ gain: 0.15, duration: 0.07, frequency: 1500, q: 2.2 });
      tone({ type: 'square', gain: 0.055, duration: 0.05, from: 230, to: 380, delay: 0.04 });
    },
    weaponSwitch() {
      noiseBurst({ gain: 0.1, duration: 0.06, frequency: 1900, q: 2 });
      tone({ type: 'square', gain: 0.04, duration: 0.05, from: 420, to: 300 });
    },

    // ---- impacts and feedback -----------------------------------------------------------------
    hit(head) {
      if (!ctx) return;
      noiseBurst({ gain: 0.2, duration: 0.07, type: 'lowpass', frequency: 650 });
      tone({ type: 'sine', gain: 0.14, duration: 0.07, from: head ? 1500 : 460, to: head ? 900 : 150 });
    },
    killConfirm(headshot, friendly) {
      if (!ctx) return;
      if (friendly) {
        tone({ type: 'sine', gain: 0.1, duration: 0.16, from: 220, to: 160 });
        return;
      }
      tone({ type: 'triangle', gain: 0.14, duration: 0.12, from: headshot ? 880 : 660, to: headshot ? 1320 : 880 });
      noiseBurst({ gain: 0.08, duration: 0.2, type: 'lowpass', frequency: 900, sweep: -600 });
    },
    enemyShot(distance) {
      const close = Math.max(0, 1 - distance / 60);
      noiseBurst({ gain: 0.08 + close * 0.24, duration: 0.18 + close * 0.1, frequency: 900 - close * 300, q: 0.8, sweep: -500 });
      tone({ type: 'sawtooth', gain: 0.03 + close * 0.06, duration: 0.14, from: 150, to: 70 });
    },
    playerHit() {
      noiseBurst({ gain: 0.28, duration: 0.22, type: 'lowpass', frequency: 500, q: 0.8 });
      tone({ type: 'sine', gain: 0.2, duration: 0.28, from: 120, to: 44 });
    },
    footstep(intensity = 1) {
      noiseBurst({ gain: 0.035 + intensity * 0.03, duration: 0.06, type: 'lowpass', frequency: 380 + Math.random() * 160, q: 0.7 });
    },
    jump() {
      noiseBurst({ gain: 0.05, duration: 0.1, type: 'lowpass', frequency: 600, sweep: 260 });
    },
    land() {
      noiseBurst({ gain: 0.09, duration: 0.11, type: 'lowpass', frequency: 300, sweep: -140 });
    },

    // ---- objective ----------------------------------------------------------------------------
    plantStart() {
      tone({ type: 'square', gain: 0.07, duration: 0.08, from: 320, to: 220 });
      noiseBurst({ gain: 0.12, duration: 0.2, type: 'lowpass', frequency: 700 });
    },
    plant() {
      noiseBurst({ gain: 0.24, duration: 0.3, type: 'lowpass', frequency: 900, sweep: -600 });
      tone({ type: 'square', gain: 0.12, duration: 0.18, from: 180, to: 90 });
      tone({ type: 'sine', gain: 0.1, duration: 0.5, from: 880, to: 880, delay: 0.16 });
    },
    beep(urgent) {
      tone({ type: 'sine', gain: urgent ? 0.11 : 0.07, duration: urgent ? 0.09 : 0.07, from: urgent ? 1500 : 1200, to: urgent ? 1500 : 1200 });
    },
    detonate() {
      if (!ctx) return;
      noiseBurst({ gain: 0.75, duration: 1.7, type: 'lowpass', frequency: 900, sweep: -760, q: 0.6 });
      noiseBurst({ gain: 0.45, duration: 0.6, type: 'bandpass', frequency: 320, q: 0.5 });
      tone({ type: 'sine', gain: 0.5, duration: 1.5, from: 90, to: 24 });
    },
    defuse() {
      tone({ type: 'sine', gain: 0.1, duration: 0.2, from: 620, to: 940 });
      tone({ type: 'sine', gain: 0.09, duration: 0.3, from: 940, to: 1240, delay: 0.12 });
      noiseBurst({ gain: 0.12, duration: 0.2, type: 'lowpass', frequency: 1200 });
    },

    // ---- round flow ---------------------------------------------------------------------------
    roundStart() {
      tone({ type: 'triangle', gain: 0.1, duration: 0.22, from: 196, to: 196 });
      tone({ type: 'triangle', gain: 0.09, duration: 0.28, from: 294, to: 294, delay: 0.16 });
      tone({ type: 'triangle', gain: 0.08, duration: 0.4, from: 392, to: 392, delay: 0.32 });
    },
    roundWin() {
      [330, 440, 554].forEach((f, i) => tone({ type: 'triangle', gain: 0.1, duration: 0.5, from: f, to: f, delay: i * 0.11 }));
    },
    roundLose() {
      [262, 220, 175].forEach((f, i) => tone({ type: 'triangle', gain: 0.1, duration: 0.6, from: f, to: f * 0.98, delay: i * 0.13 }));
    },
    matchEnd(won) {
      if (won) [392, 494, 587, 784].forEach((f, i) => tone({ type: 'triangle', gain: 0.12, duration: 0.9, from: f, to: f, delay: i * 0.16 }));
      else [294, 247, 196, 147].forEach((f, i) => tone({ type: 'triangle', gain: 0.12, duration: 1, from: f, to: f * 0.97, delay: i * 0.18 }));
      noiseBurst({ gain: 0.08, duration: 1.4, type: 'lowpass', frequency: 400, sweep: -250, delay: 0.15 });
    },

    // ---- interface ----------------------------------------------------------------------------
    ui() {
      tone({ type: 'sine', gain: 0.05, duration: 0.06, from: 640, to: 820 });
    },
    uiOpen() {
      noiseBurst({ gain: 0.05, duration: 0.08, frequency: 1400, q: 1.4 });
      tone({ type: 'sine', gain: 0.05, duration: 0.1, from: 480, to: 720 });
    },
    uiClose() {
      noiseBurst({ gain: 0.05, duration: 0.07, frequency: 1100, q: 1.4 });
      tone({ type: 'sine', gain: 0.05, duration: 0.1, from: 720, to: 440 });
    },
    buy() {
      tone({ type: 'square', gain: 0.05, duration: 0.06, from: 520, to: 520 });
      tone({ type: 'square', gain: 0.05, duration: 0.09, from: 780, to: 780, delay: 0.05 });
    },
    buyFail() {
      tone({ type: 'square', gain: 0.06, duration: 0.12, from: 220, to: 150 });
    },
    buyClose() {
      tone({ type: 'sine', gain: 0.06, duration: 0.18, from: 520, to: 300 });
    },
  };
}
