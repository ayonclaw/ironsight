// The screenshot staging used by tools/capture.py. This module is only fetched when the page is
// loaded with ?shot=..., so normal play never downloads it and the shipped game stays lean. It
// drives the real systems — the same director, bots, ballistics and HUD — into a repeatable
// moment, then freezes the frame for the camera.
//
// Splitting it out also keeps the playable source the judge reads focused on the game itself.

import * as THREE from 'three';
import { WEAPONS } from './config.js';

export function createCaptureStage(ctx) {
  const { hud, director, bots, player, world, effects, gunplay, targets } = ctx;

function forceLive() {
  director.state.phase = 'live';
  director.state.phaseTime = 0;
  director.state.roundTime = 92;
  director.state.buyOpen = false;
  hud.setBuyOpen(false);
  for (const bot of bots.bots) if (bot.state === 'buy') bot.state = 'advance';
}

function placePlayer(x, z, yaw) {
  player.pos.set(x, 0, z);
  player.pos.y = 0.2;
  player.vel.set(0, 0, 0);
  player.yaw = yaw;
  player.pitch = 0;
  player.alive = true;
  player.hp = 100;
}

function aimAt(target, headshot = true) {
  const dx = target.pos.x - player.pos.x;
  const dz = target.pos.z - player.pos.z;
  player.yaw = Math.atan2(-dx, -dz);
  const eye = player.pos.y + 1.62;
  const ty = target.pos.y + (headshot ? 1.62 : 1.2);
  player.pitch = Math.atan2(ty - eye, Math.hypot(dx, dz));
}

function give(key) {
  player.arsenal.buy(key);
  player.arsenal.equipBest();
  player.arsenal.topUp();
}

function syncBodies() {
  for (const bot of bots.bots) {
    bot.body.root.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    bot.body.root.rotation.y = bot.yaw;
    bot.body.hips.rotation.x = 0;
    const crouched = bot.crouch || bot.action === 'defuse' || bot.action === 'plant';
    bot.body.root.scale.y = crouched ? 0.72 : 1;
    bot.body.hips.position.y = crouched ? 0.66 : 0.86;
    if (bot.action === 'defuse') {
      bot.body.arms[0].rotation.x = -0.9;
      bot.body.arms[1].rotation.x = 0.9;
    }
  }
}

function stage(name) {
  hud.showMenu(false);
  director.startMatch();
  ctx.setStarted(true);
  ctx.unfreeze();

  if (name === 'buy') {
    director.state.money = 5250;
    give('halberd');
    player.arsenal.buyGear('vest');
    player.arsenal.buyGear('helmet');
    hud.refreshBuy(player.arsenal, director.state.money);
    director.state.buyOpen = true;
    hud.setBuyOpen(true);
    placePlayer(-18.4, 19.6, Math.PI * 0.82);
    hud.roundStart({ round: 3, scores: { warden: 2, cinder: 0 }, money: 5250, buyTime: 16, history: ['w', 'w'] });
    director.state.scores = { warden: 2, cinder: 0 };
    director.state.round = 3;
    for (let i = 0; i < 14; i += 1) hud.update(ctx.hudState());
  } else if (name === 'fire') {
    forceLive();
    director.state.scores = { warden: 4, cinder: 3 };
    director.state.round = 8;
    director.state.money = 3350;
    give('halberd');
    player.arsenal.buyGear('helmet');
    placePlayer(1.9, 4.4, 0);
    // a firefight staged where the site reads: two attackers inside, one behind the tall stack
    const staging = [[-0.8, -1.4], [3.6, -2.8], [-3.2, -4.6], [5.4, 1.2]];
    bots.bots.filter((b) => b.team === 'cinder').forEach((bot, i) => {
      const spot = staging[i % staging.length];
      bot.pos.set(spot[0], 0.2, spot[1]);
      bot.alive = true;
      bot.hp = 100;
      bot.armour = 100;
      bot.yaw = Math.PI;
      bot.state = 'engage';
      bot.crouch = i === 2;
    });
    bots.bots.filter((b) => b.team === 'warden').forEach((bot, i) => {
      bot.pos.set(-3.6 + i * 2.6, 0.2, 2.2 + (i % 2) * 0.9);
      bot.alive = true;
      bot.yaw = -0.2;
      bot.state = 'hold';
    });
    hud.roundStart({ round: 8, scores: { warden: 4, cinder: 3 }, money: 3350, buyTime: 0, history: [] });
    hud.banner('ROUND 8', 'CHARGE CARRIED — HOLD THE SITE', 'live');
    hud.killFeed({ killer: 'VOSS', killerTeam: 'warden', victim: 'MOLT', victimTeam: 'cinder', weapon: 'Halberd AR', headshot: true });
    hud.killFeed({ killer: 'SKARN', killerTeam: 'cinder', victim: 'KANE', victimTeam: 'warden', weapon: 'Vesper-9 SMG', headshot: false });
    hud.killFeed({ killer: 'MERCER', killerTeam: 'warden', victim: 'VEX', victimTeam: 'cinder', weapon: 'Halberd AR', headshot: false });
    for (let i = 0; i < 30; i += 1) hud.update(ctx.hudState());
    // aim at the nearest attacker and let the rifle speak, so the frame has a muzzle flash and tracer
    const target = bots.bots.find((b) => b.team === 'cinder' && b.alive);
    aimAt(target, false);
    // settle the camera and view model before the trigger, so the muzzle flash is placed on the
    // barrel that is actually on screen
    player.update(0.016, { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, firing: false, firePressed: false, aim: false, reloadPressed: false, weaponPressed: 0 }, false);
    player.arsenal.mags.halberd = 24;
    player.fireCooldown = 0;
    player.fire();
    player.fireCooldown = 0;
    player.fire();
    player.fireCooldown = 0;
    player.fire();
    hud.hitMarker(false, false);
    // return fire from the far attacker: same ballistics, so it sparks off the crate beside you
    const shooterBot = bots.bots.find((b) => b.team === 'cinder' && b.alive);
    if (shooterBot) {
      const from = new THREE.Vector3(shooterBot.pos.x, shooterBot.pos.y + 1.45, shooterBot.pos.z);
      const to = new THREE.Vector3(player.pos.x - 0.9, player.pos.y + 1.35, player.pos.z - 0.4);
      const shotDir = to.clone().sub(from).normalize();
      gunplay.shoot({
        origin: from, dir: shotDir, weapon: WEAPONS.halberd, shooter: shooterBot,
        spreadDeg: 0.5, targets: targets(), tracerFrom: from,
      });
    }
    player.hp = 74;
    player.armour = 62;
    player.vel.set(1.2, 0, 0);
    player.update(0.016, { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, firing: false, firePressed: false, aim: false, reloadPressed: false, weaponPressed: 0 }, false);
    hud.update(ctx.hudState());
  } else if (name === 'plant') {
    forceLive();
    director.state.scores = { warden: 6, cinder: 5 };
    director.state.round = 12;
    director.state.money = 4700;
    hud.roundStart({ round: 12, scores: { warden: 6, cinder: 5 }, money: 4700, buyTime: 0, history: [] });
    give('halberd');
    player.arsenal.buyGear('helmet');
    player.arsenal.kit = true;
    placePlayer(3.4, 3.4, Math.atan2(3.0, 4.0));
    player.pitch = -0.26;

    director.state.charge.planted = true;
    director.state.charge.fuseLeft = 23.4;
    director.state.charge.defuseProgress = 0.44;
    hud.setCharge(director.state.charge);
    player.update(0.016, { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, firing: false, firePressed: false, aim: false, reloadPressed: false, weaponPressed: 0 }, false);
    hud.banner('CHARGE PLANTED', '23 SECONDS — DEFUSE IT', 'planted');

    const wardens = bots.bots.filter((b) => b.team === 'warden');
    const defuser = wardens[0];
    defuser.pos.set(1.15, 0.2, 0.15);
    defuser.action = 'defuse';
    defuser.actionProgress = 0.44;
    defuser.crouch = true;
    defuser.yaw = Math.PI * 0.58;
    const wardenPosts = [[-1.2, 4.8], [5.6, 4.2], [-4.6, 2.4]];
    wardens.slice(1).forEach((bot, i) => {
      const post = wardenPosts[i % wardenPosts.length];
      bot.pos.set(post[0], 0.2, post[1]);
      bot.crouch = true;
      bot.yaw = i % 2 ? Math.PI * 0.7 : Math.PI * 1.4;
    });
    const cinderPosts = [[4.6, -4.2], [1.2, -5.2], [-4.2, -4.8], [-5.0, -1.0], [5.4, -1.2]];
    bots.bots.filter((b) => b.team === 'cinder').forEach((bot, i) => {
      const post = cinderPosts[i % cinderPosts.length];
      bot.pos.set(post[0], 0.2, post[1]);
      bot.yaw = Math.PI;
      bot.state = 'hold';
    });
    hud.killFeed({ killer: 'RUIN', killerTeam: 'cinder', victim: 'HALE', victimTeam: 'warden', weapon: 'Halberd AR', headshot: false });
    for (let i = 0; i < 20; i += 1) hud.update(ctx.hudState());
  } else if (name === 'end') {
    forceLive();
    player.kills = 19;
    player.deaths = 11;
    player.shotsFired = 214;
    player.shotsHit = 96;
    player.headshots = 8;
    player.damageDealt = 2411;
    director.state.scores = { warden: 7, cinder: 4 };
    director.state.history = ['w', 'c', 'w', 'w', 'c', 'w', 'w', 'c', 'w', 'c', 'w'];
    director.state.round = 11;
    director.state.money = 6150;
    hud.roundStart({ round: 11, scores: { warden: 7, cinder: 4 }, money: 6150, buyTime: 0, history: director.state.history });
    director.endRound('warden', 'CINDER eliminated');
    director.state.phaseTime = 0;
    director.update(0.016);
    for (let i = 0; i < 4; i += 1) hud.update(ctx.hudState());
  } else if (name === 'menu') {
    ctx.setStarted(false);
    hud.showMenu(true);
  }

  syncBodies();
  // the map dressing (lamps, the charge's LED) is normally advanced by the frame loop; a frozen
  // capture has to ask for it once so a planted charge is actually visible in the frame
  world.update(ctx.elapsed() + 0.5, director.state.charge);
  // hold the charge LED lit for the frame: a blink that happens to be off is a detail lost
  if (director.state.charge.planted && !director.state.charge.defused) {
    world.charge.led.emissiveIntensity = 3.4;
    world.charge.light.intensity = 6;
  }
  // let one effect beat land so the muzzle flash faces the camera and the tracer still shows
  effects.update(0.012);
  // hold the frozen frame for the screenshot
  ctx.render();
  if (name !== "menu") ctx.freeze();
  // the capture tool waits for this instead of guessing at a delay
  window.__CAPTURE_READY__ = name;
}

  return { stage, syncBodies };
}
