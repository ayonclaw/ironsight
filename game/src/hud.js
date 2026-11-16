// The DOM HUD. It owns no simulation: main.js pushes numbers in and the overlay button pulls a
// single action callback out. Updates are guarded so the render loop never churns the DOM.
const $ = (id) => document.getElementById(id);

export function createHud() {
  const root = $('hud');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBlock = $('ammo');
  const reloadBar = $('reload-bar');
  const reloadFill = $('reload-fill');
  const waveLabel = $('wave-label');
  const waveLeft = $('wave-left');
  const waveBar = $('wave-bar');
  const scoreValue = $('score-value');
  const bestValue = $('best-value');
  const combo = $('combo');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const vignette = $('vignette');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const overlay = $('overlay');
  const panelStart = $('panel-start');
  const panelPause = $('panel-pause');
  const panelDeath = $('panel-death');
  const playButton = $('play');
  const resumeButton = $('resume');
  const restartButton = $('restart');
  const deathScore = $('death-score');
  const deathBest = $('death-best');
  const deathWave = $('death-wave');
  const deathKills = $('death-kills');
  const deathAccuracy = $('death-accuracy');
  const deathTime = $('death-time');
  const startBest = $('start-best');
  const muteTag = $('mute-tag');
  const hint = $('hint');

  let action = () => {};
  let lastHealth = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastScore = -1;
  let lastBest = -1;
  let lastWave = '';
  let lastLeft = -1;
  let lastCombo = -1;
  let bannerTimer = 0;
  let hitTimer = 0;
  let vignetteTimer = 0;

  root.classList.remove('idle');

  function onAction(handler) {
    action = handler;
  }
  playButton.addEventListener('click', () => action('play'));
  resumeButton.addEventListener('click', () => action('resume'));
  restartButton.addEventListener('click', () => action('restart'));

  function setHealth(value, max) {
    const rounded = Math.ceil(value);
    if (rounded === lastHealth) return;
    lastHealth = rounded;
    const frac = Math.max(0, Math.min(1, value / max));
    healthFill.style.transform = `scaleX(${frac})`;
    healthValue.textContent = String(Math.max(0, rounded));
    healthFill.classList.toggle('low', frac < 0.32);
    root.classList.toggle('critical', frac < 0.22);
  }

  function setAmmo(mag, reserve, reloading, progress) {
    if (mag !== lastMag || reserve !== lastReserve) {
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = String(reserve);
      ammoBlock.classList.toggle('empty', mag === 0);
    }
    reloadBar.classList.toggle('on', reloading);
    if (reloading) reloadFill.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
  }

  function setScore(score, best) {
    if (score !== lastScore) {
      lastScore = score;
      scoreValue.textContent = String(score);
    }
    if (best !== lastBest) {
      lastBest = best;
      bestValue.textContent = String(best);
    }
  }

  function setWave(label, left, fraction) {
    if (label !== lastWave) {
      lastWave = label;
      waveLabel.textContent = label;
    }
    if (left !== lastLeft) {
      lastLeft = left;
      waveLeft.textContent = String(left);
    }
    waveBar.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
  }

  function setCombo(count) {
    if (count === lastCombo) return;
    lastCombo = count;
    if (count >= 3) {
      combo.textContent = `${count}× CHAIN`;
      combo.classList.add('on');
    } else {
      combo.classList.remove('on');
    }
  }

  function setSpread(pixels) {
    const gap = Math.round(4 + Math.min(1, pixels) * 22);
    crosshair.style.setProperty('--gap', `${gap}px`);
  }

  function hitMarker(kill, head) {
    hitmarker.classList.remove('kill', 'head');
    hitmarker.classList.add('on');
    if (kill) hitmarker.classList.add('kill');
    if (head) hitmarker.classList.add('head');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill', 'head'), 110);
  }

  function damageFlash(strength) {
    vignette.style.opacity = String(Math.min(0.92, 0.32 + strength * 0.5));
    vignette.classList.add('on');
    clearTimeout(vignetteTimer);
    vignetteTimer = setTimeout(() => {
      vignette.classList.remove('on');
      vignette.style.opacity = '0';
    }, 140);
  }

  function showBanner(title, sub, holdMs = 1600) {
    bannerTitle.textContent = title;
    bannerSub.textContent = sub;
    banner.classList.add('on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
  }

  function showOverlay(mode, stats) {
    overlay.hidden = false;
    overlay.classList.toggle('menu', mode === 'start');
    panelStart.hidden = mode !== 'start';
    panelPause.hidden = mode !== 'pause';
    panelDeath.hidden = mode !== 'death';
    if (mode === 'start') {
      startBest.textContent = String(stats?.best ?? 0);
      setTimeout(() => playButton.focus(), 30);
    }
    if (mode === 'pause') setTimeout(() => resumeButton.focus(), 30);
    if (mode === 'death' && stats) {
      deathScore.textContent = String(stats.score);
      deathBest.textContent = String(stats.best);
      deathWave.textContent = String(stats.wave);
      deathKills.textContent = String(stats.kills);
      deathAccuracy.textContent = `${Math.round(stats.accuracy * 100)}%`;
      const seconds = Math.floor(stats.time);
      deathTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      setTimeout(() => restartButton.focus(), 30);
    }
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function setMuted(muted) {
    muteTag.textContent = muted ? 'MUTED' : 'SOUND';
    muteTag.classList.toggle('off', muted);
  }

  function setHint(text) {
    hint.textContent = text;
    hint.classList.toggle('on', Boolean(text));
  }

  return {
    onAction,
    setHealth,
    setAmmo,
    setScore,
    setWave,
    setCombo,
    setSpread,
    hitMarker,
    damageFlash,
    showBanner,
    showOverlay,
    hideOverlay,
    setMuted,
    setHint,
  };
}