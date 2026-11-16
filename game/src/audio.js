// All sound is synthesised here with WebAudio: noise buffers, oscillators, filters and gain
// envelopes. No audio files, no network. The context is created on the first user gesture
// (browsers require it) and every call is safe when audio is unavailable, so headless capture
// runs without a context at all.

export function createAudio() {
  let ctx = null;
  let master = null;
  let comp = null;
  let noise = null;
  let muted = false;

  function boot() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 22;
    comp.ratio.value = 7;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(comp);
    comp.connect(ctx.destination);

    // One second of white noise, reused by every percussive voice.
    const length = Math.floor(ctx.sampleRate);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.42 + white * 0.58;
      data[i] = last;
    }
    return ctx;
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function noiseBurst({ gain = 0.3, duration = 0.12, filter = 'bandpass', frequency = 1800, q = 1.1, attack = 0.002, sweep = 0, delay = 0 }) {
    if (!ctx || muted) return;
    const t = now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.frequency.setValueAtTime(Math.max(40, frequency), t);
    if (sweep) biquad.frequency.exponentialRampToValueAtTime(Math.max(40, frequency + sweep), t + duration);
    biquad.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(biquad);
    biquad.connect(env);
    env.connect(master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  function tone({ type = 'sine', gain = 0.2, duration = 0.18, from = 440, to = 220, attack = 0.004, delay = 0 }) {
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
    env.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    boot,
    isMuted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },

    // Rifle shot: a hard crack with a low body and a short tail, pitch varies per round.
    shot() {
      if (!ctx) return;
      const vary = 0.9 + Math.random() * 0.2;
      noiseBurst({ gain: 0.34, duration: 0.13, frequency: 2200 * vary, q: 0.8, sweep: -1500 });
      noiseBurst({ gain: 0.16, duration: 0.06, filter: 'highpass', frequency: 4200, q: 0.7 });
      tone({ type: 'triangle', gain: 0.22, duration: 0.11, from: 168 * vary, to: 46 * vary });
    },
    dryFire() {
      if (!ctx) return;
      noiseBurst({ gain: 0.12, duration: 0.05, filter: 'highpass', frequency: 2600 });
      tone({ type: 'square', gain: 0.05, duration: 0.04, from: 900, to: 600 });
    },
    reloadStart() {
      noiseBurst({ gain: 0.14, duration: 0.09, filter: 'lowpass', frequency: 900 });
      tone({ type: 'square', gain: 0.05, duration: 0.05, from: 320, to: 190, delay: 0.02 });
    },
    reloadEnd() {
      noiseBurst({ gain: 0.16, duration: 0.07, filter: 'bandpass', frequency: 1600, q: 2.4 });
      tone({ type: 'square', gain: 0.06, duration: 0.06, from: 240, to: 400, delay: 0.05 });
    },
    // Flesh hit: dull thud; head shot gets a brighter ping on top.
    hit(head) {
      if (!ctx) return;
      noiseBurst({ gain: 0.2, duration: 0.08, filter: 'lowpass', frequency: 700, q: 0.9 });
      tone({ type: 'sine', gain: 0.12, duration: 0.09, from: head ? 1400 : 420, to: head ? 900 : 160 });
    },
    kill() {
      if (!ctx) return;
      tone({ type: 'sawtooth', gain: 0.09, duration: 0.22, from: 300, to: 70 });
      noiseBurst({ gain: 0.13, duration: 0.24, filter: 'lowpass', frequency: 1200, sweep: -900 });
    },
    enemyShot() {
      if (!ctx) return;
      tone({ type: 'sawtooth', gain: 0.1, duration: 0.2, from: 220, to: 90 });
      noiseBurst({ gain: 0.1, duration: 0.16, filter: 'bandpass', frequency: 900, q: 1.6 });
    },
    playerHit() {
      if (!ctx) return;
      noiseBurst({ gain: 0.26, duration: 0.2, filter: 'lowpass', frequency: 520, q: 0.8 });
      tone({ type: 'sine', gain: 0.18, duration: 0.26, from: 130, to: 48 });
    },
    spawnTelegraph() {
      if (!ctx) return;
      tone({ type: 'sine', gain: 0.09, duration: 0.5, from: 90, to: 180, attack: 0.05 });
      noiseBurst({ gain: 0.08, duration: 0.45, filter: 'bandpass', frequency: 420, q: 1.4 });
    },
    spawnPop() {
      if (!ctx) return;
      noiseBurst({ gain: 0.2, duration: 0.22, filter: 'lowpass', frequency: 1600, sweep: -1200 });
      tone({ type: 'square', gain: 0.07, duration: 0.16, from: 180, to: 70 });
    },
    waveStart() {
      if (!ctx) return;
      tone({ type: 'triangle', gain: 0.13, duration: 0.28, from: 320, to: 320 });
      tone({ type: 'triangle', gain: 0.13, duration: 0.34, from: 480, to: 480, delay: 0.14 });
      tone({ type: 'triangle', gain: 0.11, duration: 0.5, from: 640, to: 640, delay: 0.28 });
    },
    waveClear() {
      if (!ctx) return;
      [523, 659, 784, 1046].forEach((freq, index) => {
        tone({ type: 'sine', gain: 0.11, duration: 0.42, from: freq, to: freq, delay: index * 0.09 });
      });
    },
    pickup() {
      if (!ctx) return;
      tone({ type: 'sine', gain: 0.12, duration: 0.14, from: 720, to: 1180 });
      tone({ type: 'sine', gain: 0.08, duration: 0.2, from: 1080, to: 1500, delay: 0.07 });
    },
    footstep() {
      if (!ctx) return;
      noiseBurst({ gain: 0.045, duration: 0.07, filter: 'lowpass', frequency: 420 + Math.random() * 120, q: 0.7 });
    },
    jump() {
      if (!ctx) return;
      noiseBurst({ gain: 0.06, duration: 0.11, filter: 'lowpass', frequency: 600, sweep: 300 });
    },
    land() {
      if (!ctx) return;
      noiseBurst({ gain: 0.1, duration: 0.12, filter: 'lowpass', frequency: 320, sweep: -140 });
    },
    gameOver() {
      if (!ctx) return;
      [392, 330, 262, 196].forEach((freq, index) => {
        tone({ type: 'triangle', gain: 0.12, duration: 0.7, from: freq, to: freq * 0.94, delay: index * 0.19 });
      });
      noiseBurst({ gain: 0.1, duration: 1.1, filter: 'lowpass', frequency: 300, sweep: -200, delay: 0.1 });
    },
    ui() {
      if (!ctx) return;
      tone({ type: 'sine', gain: 0.07, duration: 0.08, from: 620, to: 820 });
    },
  };
}
