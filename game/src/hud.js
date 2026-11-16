// The interface. All of it is DOM over the canvas — no font files, no images, no layout library —
// so it stays crisp at any resolution and reads like a HUD rather than a web page.
//
// The buy menu is generated from the same weapon table the simulation uses, which is why a price
// or a stat can never drift from what a gun actually does.

import { WEAPONS, GEAR, IDENTITY, MATCH, money, clock, clamp } from './config.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    hud: $('hud'),
    scoreW: $('score-w'),
    scoreC: $('score-c'),
    pipsW: $('pips-w'),
    pipsC: $('pips-c'),
    roundLabel: $('round-label'),
    timer: $('timer'),
    phaseLabel: $('phase-label'),
    objective: $('objective'),
    objectiveText: $('objective-text'),
    objectiveFill: $('objective-fill'),
    killfeed: $('killfeed'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    prompt: $('prompt'),
    hp: $('hp'),
    hpFill: $('hp-fill'),
    ap: $('ap'),
    apFill: $('ap-fill'),
    money: $('money'),
    weaponTag: $('weapon-tag'),
    weaponName: $('weapon-name'),
    ammoMag: $('ammo-mag'),
    ammoRes: $('ammo-res'),
    slotPrimary: $('slot-1'),
    slotSide: $('slot-2'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    spectate: $('spectate'),
    spectateName: $('spectate-name'),
    buyOverlay: $('buymenu'),
    buyMoney: $('buy-money'),
    buyCards: $('buy-cards'),
    buyHint: $('buy-hint'),
    menu: $('menu'),
    pause: $('pause'),
    roundEnd: $('roundend'),
    roundEndTitle: $('roundend-title'),
    roundEndReason: $('roundend-reason'),
    roundEndScore: $('roundend-score'),
    roundEndMoney: $('roundend-money'),
    matchEnd: $('matchend'),
    matchEndTitle: $('matchend-title'),
    matchEndScore: $('matchend-score'),
    matchEndStats: $('matchend-stats'),
    matchEndStrip: $('matchend-strip'),
    scoreboard: $('scoreboard'),
    sbBody: $('sb-body'),
    damage: $('damage'),
    whiskey: $('flash'),
  };

  // Panels are shown/hidden by display as well as by the fade class: a stalled CSS transition
  // (a throttled tab, a headless capture) must never leave the menu painted over a live round.
  function setPanel(element, on) {
    element.classList.toggle('on', on);
    // Inline, not just a class: a stalled CSS transition (throttled tab, headless capture) must
    // never leave a panel half-faded over the game.
    element.style.display = on ? 'flex' : 'none';
    element.style.opacity = on ? '1' : '0';
    element.style.visibility = on ? 'visible' : 'hidden';
  }

  const state = {
    spread: 0,
    lastSpread: -1,
    bannerTimer: 0,
    pipsC: 0,
  };

  // ---- build the buy menu once ---------------------------------------------------------------
  const cardIndex = [];
  function buildBuyMenu() {
    const groups = [
      { title: 'RIFLES & SMGS', items: ['halberd', 'vesper', 'breakwater'] },
      { title: 'SIDEARM', items: ['p9'] },
      { title: 'EQUIPMENT', items: ['vest', 'helmet', 'kit'] },
    ];
    el.buyCards.innerHTML = '';
    let key = 1;
    for (const group of groups) {
      const section = document.createElement('div');
      section.className = 'buy-group';
      const h = document.createElement('span');
      h.className = 'buy-group-title';
      h.textContent = group.title;
      section.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'buy-grid';
      for (const itemKey of group.items) {
        const def = WEAPONS[itemKey] || GEAR[itemKey];
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'buy-card';
        card.dataset.key = itemKey;
        card.dataset.slot = key;
        card.innerHTML = `
          <span class="card-top"><b class="card-key">${key}</b><span class="card-tag">${def.tag || 'GEAR'}</span></span>
          <span class="card-name">${def.name}</span>
          <span class="card-price">${money(def.price)}</span>
          <span class="card-stats">${WEAPONS[itemKey] ? statBars(def) : `<em>${def.blurb}</em>`}</span>
          <span class="card-owned">OWNED</span>`;
        card.addEventListener('click', () => {
          el.buyOverlay.dispatchEvent(new CustomEvent('buy', { detail: itemKey, bubbles: true }));
        });
        grid.appendChild(card);
        cardIndex.push({ key: itemKey, slot: key, card });
        key += 1;
      }
      section.appendChild(grid);
      el.buyCards.appendChild(section);
    }
  }

  // Four little bars: damage, rate of fire, accuracy (inverted spread), mobility.
  function statBars(w) {
    const bars = [
      ['DMG', clamp(w.damage * (w.pellets || 1) / 140, 0.08, 1)],
      ['ROF', clamp(w.rpm / 800, 0.1, 1)],
      ['ACC', clamp(1 - w.spread / 3.4, 0.12, 1)],
      ['MOB', clamp((w.speed - 0.9) / 0.16, 0.12, 1)],
    ];
    return bars
      .map(([label, v]) => `<span class="stat-row"><i>${label}</i><span class="stat-track"><span style="width:${(v * 100).toFixed(0)}%"></span></span></span>`)
      .join('');
  }
  buildBuyMenu();

  // ---- buy menu binding ------------------------------------------------------------------------
  el.buyOverlay.addEventListener('buy', (event) => {
    if (onBuy) onBuy(event.detail);
  });
  let onBuy = null;

  function refreshBuyMenu(arsenal, cash) {
    el.buyMoney.textContent = money(cash);
    for (const entry of cardIndex) {
      const def = WEAPONS[entry.key] || GEAR[entry.key];
      const card = entry.card;
      const owned = arsenal ? arsenal.owns(entry.key) : false;
      const afford = cash >= def.price;
      card.classList.toggle('owned', owned);
      card.classList.toggle('locked', !owned && !afford);
    }
  }

  function pips(container, total, alive, team) {
    if (container.childElementCount !== total) {
      container.innerHTML = '';
      for (let i = 0; i < total; i += 1) {
        const pip = document.createElement('i');
        pip.className = team;
        container.appendChild(pip);
      }
    }
    for (let i = 0; i < total; i += 1) {
      container.children[i].classList.toggle('dead', i >= alive);
    }
  }

  const api = {
    setBuyHandler(fn) {
      onBuy = fn;
    },

    showMenu(show) {
      setPanel(el.menu, show);
      el.hud.classList.toggle('hidden', show);
    },

    // ---- per-frame readout -------------------------------------------------------------------
    update({ phase, roundTime, buyTime, scores, money: cash, player, arsenal, aliveW, aliveC, spread, charge, defusePrompt }) {
      el.scoreW.textContent = scores.warden;
      el.scoreC.textContent = scores.cinder;
      pips(el.pipsW, MATCH.teamSize, aliveW, 'w');
      pips(el.pipsC, MATCH.teamSize, aliveC, 'c');

      if (phase === 'buy') {
        el.timer.textContent = clock(buyTime);
        el.phaseLabel.textContent = 'BUY PHASE';
        el.phaseLabel.className = 'phase buy';
      } else if (phase === 'live') {
        el.timer.textContent = clock(charge.planted && !charge.defused ? charge.fuseLeft : roundTime);
        el.phaseLabel.textContent = charge.planted ? 'CHARGE ARMED' : 'ROUND LIVE';
        el.phaseLabel.className = charge.planted ? 'phase armed' : 'phase live';
      } else {
        el.phaseLabel.textContent = phase === 'roundEnd' ? 'ROUND OVER' : '';
        el.phaseLabel.className = 'phase';
      }

      const hp = Math.max(0, Math.ceil(player.hp));
      el.hp.textContent = hp;
      el.hpFill.style.width = `${hp}%`;
      el.hpFill.classList.toggle('low', hp <= 30);
      el.ap.textContent = Math.ceil(player.armour);
      el.apFill.style.width = `${player.armour}%`;
      el.money.textContent = money(cash);
      const w = WEAPONS[arsenal.current];
      el.weaponName.textContent = w.name;
      el.weaponTag.textContent = w.tag;
      el.ammoMag.textContent = arsenal.mags[w.key];
      el.ammoRes.textContent = `/ ${arsenal.reserves[w.key]}`;
      el.ammoMag.classList.toggle('empty', arsenal.mags[w.key] === 0);
      el.ammoMag.classList.toggle('low', arsenal.mags[w.key] <= Math.ceil(w.mag * 0.25));
      el.slotPrimary.textContent = arsenal.owned.primary ? `1 ${WEAPONS[arsenal.owned.primary].name.split(' ')[0]}` : '1 EMPTY';
      el.slotPrimary.classList.toggle('empty', !arsenal.owned.primary);
      el.slotSide.textContent = `2 ${WEAPONS[arsenal.owned.sidearm].name.split(' ')[0]}`;

      // objective strip
      el.objective.classList.toggle('on', charge.planted && !charge.defused && !charge.detonated);
      if (charge.planted) {
        if (charge.defused) {
          el.objectiveText.textContent = 'CHARGE DEFUSED';
          el.objectiveFill.style.width = '100%';
        } else if (charge.detonated) {
          el.objectiveText.textContent = 'CHARGE DETONATED';
          el.objectiveFill.style.width = '100%';
        } else {
          el.objectiveText.textContent = `CHARGE ARMED — ${clock(charge.fuseLeft)}`;
          el.objectiveFill.style.width = `${(1 - charge.fuseLeft / MATCH.fuseTime) * 100}%`;
          if (charge.defuseProgress > 0) {
            el.objectiveText.textContent = `DEFUSING — ${Math.round(charge.defuseProgress * 100)}%`;
            el.objectiveFill.style.width = `${charge.defuseProgress * 100}%`;
          }
        }
      }

      // dynamic crosshair
      const gap = 4 + spread * 3.4;
      if (Math.abs(spread - state.lastSpread) > 0.08) {
        el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
        state.lastSpread = spread;
      }
      el.crosshair.classList.toggle('hidden', !player.alive);

      if (defusePrompt) {
        el.prompt.textContent = `HOLD E — DEFUSE · ${defusePrompt}`;
        el.prompt.classList.add('on');
      } else {
        el.prompt.classList.remove('on');
      }
    },

    roundStart({ round, scores, buyTime }) {
      el.roundLabel.textContent = `ROUND ${round}`;
      el.scoreW.textContent = scores.warden;
      el.scoreC.textContent = scores.cinder;
      api.banner(`ROUND ${round}`, 'BUY PHASE — B FOR THE ARMOURY', 'round');
      el.hud.classList.remove('hidden');
      setPanel(el.roundEnd, false);
    },

    banner(title, sub, kind = '') {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub || '';
      el.banner.className = `on ${kind}`;
      state.bannerTimer = 2.6;
      window.clearTimeout(api._bannerHide);
      api._bannerHide = window.setTimeout(() => el.banner.classList.remove('on'), 2600);
    },

    setBuyOpen(open) {
      setPanel(el.buyOverlay, open);
      el.hud.classList.toggle('buying', open);
    },

    refreshBuy(arsenal, cash) {
      refreshBuyMenu(arsenal, cash);
    },

    buyDone(key, cash, arsenal) {
      refreshBuyMenu(arsenal, cash);
      const def = WEAPONS[key] || GEAR[key];
      el.buyHint.textContent = `${def.name} — acquired`;
      el.buyHint.classList.add('pulse');
      window.setTimeout(() => el.buyHint.classList.remove('pulse'), 500);
      for (const entry of cardIndex) {
        if (entry.key === key) {
          entry.card.classList.add('just-bought');
          window.setTimeout(() => entry.card.classList.remove('just-bought'), 600);
        }
      }
    },

    buyError(text) {
      el.buyHint.textContent = text;
      el.buyHint.classList.add('error');
      window.setTimeout(() => el.buyHint.classList.remove('error'), 900);
    },

    killFeed({ killer, killerTeam, victim, victimTeam, weapon, headshot }) {
      const entry = document.createElement('div');
      entry.className = 'feed-entry';
      const k = killer ? `<span class="${killerTeam}">${killer}</span>` : '<span class="muted">THE YARD</span>';
      const v = `<span class="${victimTeam}">${victim}</span>`;
      entry.innerHTML = `${k}<span class="feed-weapon">${weapon}</span>${headshot ? '<span class="hs">HS</span>' : ''}${v}`;
      el.killfeed.prepend(entry);
      while (el.killfeed.childElementCount > 5) el.killfeed.lastElementChild.remove();
      window.setTimeout(() => entry.classList.add('fade'), 4200);
      window.setTimeout(() => entry.remove(), 5200);
    },

    hitMarker(headshot, kill) {
      el.hitmarker.className = '';
      void el.hitmarker.offsetWidth;
      el.hitmarker.className = kill ? 'kill' : headshot ? 'head' : 'hit';
    },

    damage(directionAngle) {
      const arc = el.damage.querySelector(`[data-dir="${directionAngle}"]`);
      if (!arc) return;
      arc.classList.remove('hit');
      void arc.offsetWidth;
      arc.classList.add('hit');
    },

    hurtFlash() {
      el.whiskey.classList.remove('on');
      void el.whiskey.offsetWidth;
      el.whiskey.classList.add('on');
    },

    setCharge(charge) {
      el.objective.classList.toggle('on', charge.planted && !charge.defused && !charge.detonated);
    },

    setDefusePrompt(text) {
      if (!text) el.prompt.classList.remove('on');
    },

    setSpectate(name) {
      el.spectate.classList.toggle('on', !!name);
      if (name) el.spectateName.textContent = name;
    },

    roundEnd({ winner, reason, scores, money: cash, survived, winBonus, lossBonus }) {
      el.roundEndTitle.textContent = winner === 'warden' ? 'WARDEN TAKES THE ROUND' : 'CINDER TAKES THE ROUND';
      el.roundEndTitle.className = winner;
      el.roundEndReason.textContent = reason;
      el.roundEndScore.textContent = `${scores.warden} — ${scores.cinder}`;
      const won = winner === 'warden';
      el.roundEndMoney.innerHTML = `
        <span class="${won ? 'gain' : 'gain small'}">${won ? '+' : '+'}${money(won ? winBonus : lossBonus)}</span>
        <em>${won ? 'round win' : `loss bonus · ${survived ? 'you survived' : 'you were lost'}`}</em>
        <b>${money(cash)} in the bank</b>`;
      setPanel(el.roundEnd, true);
    },

    hideRoundEnd() {
      setPanel(el.roundEnd, false);
    },

    matchEnd({ winner, scores, history, stats, playerTeam }) {
      const won = winner === playerTeam;
      setPanel(el.roundEnd, false);
      setPanel(el.matchEnd, true);
      el.matchEndTitle.textContent = won ? 'WARDEN HOLDS THE YARD' : 'CINDER BREAKS THE YARD';
      el.matchEndTitle.className = winner;
      el.matchEndScore.textContent = `${scores.warden} — ${scores.cinder}`;
      el.matchEndStrip.innerHTML = history
        .map((h) => `<i class="${h === 'w' ? 'w' : 'c'}"></i>`)
        .join('');
      el.matchEndStats.innerHTML = `
        <div><span>KILLS</span><b>${stats.kills}</b></div>
        <div><span>DEATHS</span><b>${stats.deaths}</b></div>
        <div><span>ACCURACY</span><b>${Math.round(stats.accuracy * 100)}%</b></div>
        <div><span>HEADSHOTS</span><b>${stats.headshots}</b></div>
        <div><span>DAMAGE</span><b>${stats.damage}</b></div>`;
      el.matchEnd.classList.add('on');
      api.releaseLock?.();
    },

    showPause(show) {
      setPanel(el.pause, show);
    },

    showScoreboard(show, rows) {
      setPanel(el.scoreboard, show);
      if (!show || !rows) return;
      el.sbBody.innerHTML = rows
        .map((r) => `<tr class="${r.team}"><td>${r.name}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${money(r.money)}</td><td>${r.alive ? '' : '—'}</td></tr>`)
        .join('');
    },

    toast(text) {
      el.buyHint.textContent = text;
    },

    updateBanner(dt) {
      state.bannerTimer = Math.max(0, state.bannerTimer - dt);
    },

  };

  // Static copy that never changes at runtime.
  $('map-name').textContent = IDENTITY.map;
  $('map-line').textContent = IDENTITY.mapLine;
  $('title-sub').textContent = IDENTITY.subtitle;
  $('title-tag').textContent = IDENTITY.tagline;
  return api;
}
