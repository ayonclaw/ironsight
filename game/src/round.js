// The director: one match, one round at a time. It owns the clock, the money, the charge and the
// score, and it tells the HUD what to show. Nothing in here draws anything — it is the rulebook
// the renderer and the bots both obey.
//
// A round: buy (20 s) → live (1:45) → one of four endings:
//   elimination, the charge detonating, a defuse, or the clock running out for the attackers.
// The winner banks a round bonus, the loser banks a loss bonus that grows with the streak, and
// every kill pays the shooter. First to eight takes the match.

import * as THREE from 'three';
import { MATCH, ECONOMY, WEAPONS, GEAR, TEAMS, money } from './config.js';

export function createDirector({ world, bots, player, hud, audio, effects, targets, camera }) {
  const state = {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    phaseTime: 0,
    roundTime: 0,
    round: 0,
    scores: { warden: 0, cinder: 0 },
    history: [], // 'w' | 'c' per round, for the strip on the end screen
    lossStreak: { warden: 0, cinder: 0 },
    money: ECONOMY.start,
    charge: {
      planted: false,
      defused: false,
      detonated: false,
      plantedAt: 0,
      fuseLeft: MATCH.fuseTime,
      defuseProgress: 0,
      carrier: null,
      defuser: null,
    },
    lastWin: null,
    spectate: null,
    playerAliveAtEnd: false,
    roundLog: [],
    buyOpen: false,
    paused: false,
    elapsed: 0,
  };

  const camTarget = new THREE.Vector3();
  const camOffset = new THREE.Vector3();

  // ---- helpers --------------------------------------------------------------------------------
  const livingBots = (team) => bots.bots.filter((b) => b.team === team && b.alive);
  const teamAlive = (team) => livingBots(team).length + (team === player.team && player.alive ? 1 : 0);
  const otherTeam = (team) => (team === 'warden' ? 'cinder' : 'warden');

  function goalFor(bot) {
    const team = bot.team;
    if (team === 'cinder') {
      if (bot.role === 'sapper') {
        return { x: world.plantSpot.x, z: world.plantSpot.z, lookX: 0, lookZ: 8 };
      }
      const hold = world.holds.cinder[(bot.spawnIndex + 1) % world.holds.cinder.length];
      const stage = world.staging.cinder[bot.spawnIndex % world.staging.cinder.length];
      // Stage outside the site until the carrier is nearly in, then commit with it.
      const carrier = bots.bots.find((b) => b.team === 'cinder' && b.role === 'sapper' && b.alive);
      const carrierClose = carrier
        ? Math.hypot(carrier.pos.x - world.plantSpot.x, carrier.pos.z - world.plantSpot.z) < 11
        : true;
      if (!state.charge.planted && !carrierClose) return { x: stage.x, z: stage.z, lookX: 0, lookZ: 0 };
      return { x: hold.x, z: hold.z, lookX: hold.look.x, lookZ: hold.look.z };
    }
    // Once the charge is down, every defender's job is the same: get on the pad and defuse.
    // They ring it rather than stacking on one point, which also keeps their bodies out of one
    // another's line of fire while they work.
    if (state.charge.planted && !state.charge.defused && !state.charge.detonated) {
      const a = (bot.spawnIndex / 5) * Math.PI * 2 + 0.6;
      return {
        x: world.plantSpot.x + Math.cos(a) * 1.5,
        z: world.plantSpot.z + Math.sin(a) * 1.5,
        lookX: world.plantSpot.x,
        lookZ: world.plantSpot.z,
      };
    }
    const hold = world.holds.warden[bot.spawnIndex % world.holds.warden.length];
    return { x: hold.x, z: hold.z, lookX: hold.look.x, lookZ: hold.look.z };
  }

  // ---- economy ---------------------------------------------------------------------------------
  function payout(team, won) {
    if (won) {
      state.lossStreak[team] = 0;
      for (const bot of bots.bots) if (bot.team === team) bot.money = Math.min(ECONOMY.max, bot.money + ECONOMY.win);
      if (team === player.team) state.money = Math.min(ECONOMY.max, state.money + ECONOMY.win);
    } else {
      state.lossStreak[team] = Math.min(4, state.lossStreak[team] + 1);
      const bonus = Math.min(ECONOMY.lossCap, ECONOMY.lossBase + (state.lossStreak[team] - 1) * ECONOMY.lossStep);
      for (const bot of bots.bots) if (bot.team === team) bot.money = Math.min(ECONOMY.max, bot.money + bonus);
      if (team === player.team) state.money = Math.min(ECONOMY.max, state.money + bonus);
    }
  }

  function payPlayer(amount) {
    state.money = Math.min(ECONOMY.max, state.money + amount);
  }

  // ---- kills -----------------------------------------------------------------------------------
  function feed(killer, victim, weapon, headshot) {
    hud.killFeed({
      killer: killer ? killer.name : null,
      killerTeam: killer ? killer.team : null,
      victim: victim.name,
      victimTeam: victim.team,
      weapon: weapon ? weapon.name : 'the yard',
      headshot: !!headshot,
    });
  }

  const ctx = {
    actors: null,
    charge: state.charge,
    plantSpot: world.plantSpot,
    goalFor,
    onPlant(bot) {
      plant(bot);
    },
    onDefuse(bot) {
      defuse(bot);
    },
  };
  ctx.actors = targets();

  // ---- round control ---------------------------------------------------------------------------
  function resetCharge() {
    state.charge.planted = false;
    state.charge.defused = false;
    state.charge.detonated = false;
    state.charge.fuseLeft = MATCH.fuseTime;
    state.charge.defuseProgress = 0;
    state.charge.defuser = null;
    hud.setCharge(state.charge);
  }

  function startRound() {
    if (state.scores.warden >= MATCH.roundsToWin || state.scores.cinder >= MATCH.roundsToWin) {
      endMatch();
      return;
    }
    const survived = state.round === 0 ? true : state.playerAliveAtEnd;
    state.round += 1;
    state.phase = 'buy';
    state.phaseTime = MATCH.buyTime;
    state.roundTime = MATCH.roundTime;
    state.playerAliveAtEnd = false;
    resetCharge();
    state.spectate = null;

    // loadouts: the player keeps what survived, bots shop with their own money
    player.carryOver(survived);
    player.reset(world.spawns.warden[0]);
    for (const bot of bots.bots) bots.buyPhase(bot);
    bots.assignRound({ phase: 'buy', spawns: world.spawns, goal: goalFor });

    hud.roundStart({
      round: state.round,
      scores: { ...state.scores },
      money: state.money,
      buyTime: MATCH.buyTime,
      history: state.history,
    });
    hud.setBuyOpen(true);
    state.buyOpen = true;
    audio.roundStart();
  }

  function beginLive() {
    state.phase = 'live';
    state.buyOpen = false;
    hud.setBuyOpen(false);
    hud.banner(`ROUND ${state.round}`, 'LIVE — NO RESPAWNS', 'live');
    for (const bot of bots.bots) if (bot.state === 'buy') bot.state = 'advance';
    audio.buyClose();
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.phase = 'roundEnd';
    state.phaseTime = MATCH.roundEndTime;
    state.lastWin = winner;
    state.scores[winner] += 1;
    state.history.push(winner === 'warden' ? 'w' : 'c');
    state.playerAliveAtEnd = player.alive;
    payout(winner, true);
    payout(otherTeam(winner), false);
    const summary = {
      winner,
      reason,
      scores: { ...state.scores },
      round: state.round,
      money: state.money,
      survived: player.alive,
      winBonus: ECONOMY.win,
      lossBonus: Math.min(ECONOMY.lossCap, ECONOMY.lossBase + (state.lossStreak[otherTeam(winner)] - 1) * ECONOMY.lossStep),
    };
    state.roundLog.push(summary);
    hud.roundEnd(summary);
    if (winner === player.team) audio.roundWin();
    else audio.roundLose();
    if (state.scores[winner] >= MATCH.roundsToWin) {
      state.phaseTime = 2.4;
    }
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const winner = state.scores.warden > state.scores.cinder ? 'warden' : 'cinder';
    hud.matchEnd({
      winner,
      scores: { ...state.scores },
      history: state.history,
      rounds: state.roundLog,
      playerTeam: player.team,
      stats: {
        kills: player.kills,
        deaths: player.deaths,
        accuracy: player.shotsFired ? player.shotsHit / player.shotsFired : 0,
        headshots: player.headshots,
        damage: Math.round(player.damageDealt),
      },
    });
    audio.matchEnd(winner === player.team);
  }

  function plant(bot) {
    if (state.charge.planted) return;
    state.charge.planted = true;
    state.charge.plantedAt = state.elapsed;
    state.charge.fuseLeft = MATCH.fuseTime;
    state.charge.carrier = bot;
    bot.money = Math.min(ECONOMY.max, bot.money + ECONOMY.plantReward);
    hud.banner('CHARGE PLANTED', `${MATCH.fuseTime} SECONDS — DEFEND IT`, 'planted');
    hud.setCharge(state.charge);
    audio.plant();
    // a short spark burst at the site so the plant reads even from across the map
    effects.impact(world.plantSpot.x, 0.4, world.plantSpot.z, 0, 1, 0, 'metal');
  }

  function defuse(bot) {
    if (!state.charge.planted || state.charge.defused) return;
    state.charge.defused = true;
    state.charge.defuser = bot;
    if (bot === player) payPlayer(ECONOMY.defuseReward);
    else bot.money = Math.min(ECONOMY.max, bot.money + ECONOMY.defuseReward);
    hud.banner('CHARGE DEFUSED', 'SITE HELD', 'defused');
    hud.setCharge(state.charge);
    audio.defuse();
  }

  // ---- player actions ---------------------------------------------------------------------------
  function canBuy() {
    return state.phase === 'buy' && state.buyOpen;
  }

  function buy(key) {
    if (!canBuy()) return { ok: false, why: 'Buying is closed' };
    const item = WEAPONS[key] || GEAR[key];
    if (!item) return { ok: false, why: 'Unknown item' };
    if (player.arsenal.owns(key)) return { ok: false, why: 'Already owned' };
    if (item.kind === 'gear' && key === 'kit' && player.team !== 'warden') return { ok: false, why: 'Defenders only' };
    if (state.money < item.price) return { ok: false, why: 'Not enough money' };
    state.money -= item.price;
    if (WEAPONS[key]) player.arsenal.buy(key);
    else player.arsenal.buyGear(key);
    audio.buy();
    hud.buyDone(key, state.money, player.arsenal);
    return { ok: true };
  }

  function toggleBuy() {
    if (state.phase !== 'buy') return;
    state.buyOpen = !state.buyOpen;
    hud.setBuyOpen(state.buyOpen);
    if (state.buyOpen) audio.uiOpen(); else audio.uiClose();
  }

  // ---- the player's own objective work (defuse) -------------------------------------------------
  function updateDefuse(dt, holding) {
    if (!state.charge.planted || state.charge.defused || state.charge.detonated) return;
    const d = Math.hypot(player.pos.x - world.plantSpot.x, player.pos.z - world.plantSpot.z);
    const near = d < MATCH.plantRadius + 0.7 && player.alive;
    if (holding && near) {
      const time = player.arsenal.kit ? MATCH.defuseKitTime : MATCH.defuseTime;
      state.charge.defuseProgress += dt / time;
      state.charge.defuser = player;
      hud.setCharge(state.charge);
      if (state.charge.defuseProgress >= 1) defuse(player);
    } else if (state.charge.defuseProgress > 0) {
      state.charge.defuseProgress = Math.max(0, state.charge.defuseProgress - dt * 0.9);
      hud.setCharge(state.charge);
    }
    hud.setDefusePrompt(near ? (player.arsenal.kit ? 'HOLDING KIT — 5s' : 'NO KIT — 10s') : null);
  }

  // ---- main tick ---------------------------------------------------------------------------------
  function update(dt) {
    if (state.phase === 'menu' || state.phase === 'matchEnd') return;
    state.elapsed += dt;

    if (state.phase === 'buy') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) beginLive();
    } else if (state.phase === 'live') {
      state.roundTime -= dt;
      const alive = { warden: teamAlive('warden'), cinder: teamAlive('cinder') };

      // the charge's fuse
      if (state.charge.planted && !state.charge.defused && !state.charge.detonated) {
        state.charge.fuseLeft -= dt;
        if (state.charge.fuseLeft <= 0) {
          state.charge.detonated = true;
          effects.detonation(world.plantSpot.x, 0.6, world.plantSpot.z);
          audio.detonate();
          endRound('cinder', 'The charge detonated');
        }
        // beeping quickens as the fuse burns; the HUD reads the number
        hud.setCharge(state.charge);
        if (Math.random() < dt * (2 + (MATCH.fuseTime - state.charge.fuseLeft) * 0.22)) audio.beep(state.charge.fuseLeft < 12);
      }

      if (state.phase === 'live' && !state.charge.planted) {
        // A dead carrier drops the charge; the next attacker picks it up rather than losing the
        // round to a stalemate. This is the one job the AI hands over explicitly.
        const carrier = bots.bots.find((b) => b.team === 'cinder' && b.role === 'sapper' && b.alive);
        if (!carrier) {
          const next = bots.bots.find((b) => b.team === 'cinder' && b.alive);
          if (next) {
            for (const b of bots.bots) if (b.role === 'sapper' && !b.alive) b.role = 'entry';
            next.role = 'sapper';
            next.body.charge.visible = true;
            next.state = 'advance';
            hud.banner('CHARGE TRANSFERRED', `${next.name} IS CARRYING IT NOW`, 'planted');
            audio.ui();
          }
        }
      }

      if (state.phase === 'live') {
        // elimination
        if (alive.cinder === 0 && !state.charge.planted) endRound('warden', 'CINDER eliminated');
        else if (alive.cinder === 0 && state.charge.defused) endRound('warden', 'Charge defused');
        else if (alive.warden === 0) endRound('cinder', 'WARDEN eliminated');
        else if (state.roundTime <= 0) {
          if (state.charge.planted && !state.charge.defused) {
            // the clock no longer matters once it is down; the fuse is the clock
          } else {
            endRound('warden', 'Time expired — site held');
          }
        }
      }
    } else if (state.phase === 'roundEnd') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        if (state.scores.warden >= MATCH.roundsToWin || state.scores.cinder >= MATCH.roundsToWin) endMatch();
        else startRound();
      }
    }
  }

  // ---- camera when the player is down -----------------------------------------------------------
  function updateSpectate(dt) {
    if (player.alive || state.phase === 'menu') return;
    let target = state.spectate;
    if (!target || !target.alive) {
      const mates = livingBots(player.team);
      target = mates.length ? mates[Math.floor(state.elapsed / 6) % mates.length] : null;
      state.spectate = target;
      hud.setSpectate(target ? target.name : null);
    }
    if (!target) return;
    camOffset.set(Math.sin(target.yaw) * 3.2, 2.5, Math.cos(target.yaw) * 3.2);
    camTarget.set(target.pos.x + camOffset.x, target.pos.y + camOffset.y, target.pos.z + camOffset.z);
    // ease the camera over so a teammate swap is not a jump cut
    const k = Math.min(1, dt * 6);
    camera.position.lerp(camTarget, k);
    camera.lookAt(target.pos.x, target.pos.y + 1.4, target.pos.z);
  }

  return {
    state,
    ctx,
    startMatch() {
      state.phase = 'buy';
      state.round = 0;
      state.scores = { warden: 0, cinder: 0 };
      state.history = [];
      state.roundLog = [];
      state.lossStreak = { warden: 0, cinder: 0 };
      state.money = ECONOMY.start;
      state.elapsed = 0;
      for (const bot of bots.bots) {
        bot.money = ECONOMY.start;
        bot.kills = 0;
        bot.deaths = 0;
      }
      player.kills = 0;
      player.deaths = 0;
      player.shotsFired = 0;
      player.shotsHit = 0;
      player.headshots = 0;
      player.damageDealt = 0;
      player.arsenal.reset();
      startRound();
    },
    nextRound: startRound,
    update,
    updateSpectate,
    updateDefuse,
    buy,
    toggleBuy,
    canBuy,
    endRound,
    // Kill accounting, called by the event bus in main.js so the director owns the economy.
    registerKill(killer, victim, weapon, headshot) {
      if (killer === player) {
        player.kills += 1;
        payPlayer(weapon ? weapon.killReward : 300);
      } else if (killer && killer.money !== undefined) {
        killer.kills += 1;
        killer.money = Math.min(ECONOMY.max, killer.money + (weapon ? weapon.killReward : 300));
      }
      feed(killer, victim, weapon, headshot);
      audio.killConfirm(headshot, victim.team === player.team);
    },
    registerAssist(dmg) {
      player.damageDealt += dmg;
    },
    payPlayer,
    teams: TEAMS,
    moneyText: () => money(state.money),
    spectateName: () => (state.spectate ? state.spectate.name : null),
  };
}
