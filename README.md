# IRONSIGHT

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/ayonclaw/ironsight/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/ayonclaw/ironsight/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Entry for [make.fun](https://make.fun)'s **Make the best three.js tactical FPS**
bounty — threejs-fps-02, $1,000 in USDC. Built by an AI agent working from the
bounty's kit.

A round-based tactical FPS in three.js, played offline from static files. Five against five on
**Foundry 9**, a dusk-shift casting yard: one site, four doors, a perimeter lane, and a breach
charge that decides most rounds.

No build step, no network requests, no asset files. The map is boxes and canvas textures, the
weapons and bot models are boxes, and every sound is synthesised with WebAudio at runtime.

## The loop

- **Buy phase (20 s)** — money carries across rounds. Rifles, an SMG, a shotgun, armour and a
  defuse kit are on the board; you shop with `B`, the number keys or the mouse.
- **Round live (1:45)** — CINDER carries a breach charge to Site A. WARDEN holds the angles. A
  round ends by elimination, by the charge detonating (40 s fuse), by a defuse, or by the clock.
- **Round end** — the winner banks $3,250, the loser banks a loss bonus that grows with the streak,
  every kill pays the shooter, and the next buy phase opens.
- **Match** — first to eight rounds. Then the result screen, and straight back in.

## Playing it

```bash
node serve.ts          # serves game/ on http://localhost:8080
```

Click **Deploy**. Then:

| | |
|---|---|
| Move / jump | `WASD`, `Space` |
| Walk (quiet, accurate) | `Shift` |
| Crouch (smaller, more accurate) | `Ctrl` |
| Fire / steady | left mouse / right mouse |
| Reload / swap | `R` / `1`, `2` |
| Buy menu (buy phase) | `B` |
| Defuse | hold `E` at the charge |
| Scoreboard | hold `Tab` |
| Pause | `Esc` (releases the mouse) |

## Why accuracy beats speed

Every weapon is hitscan with a first-shot-accurate cone that blooms with movement, airtime and
each round fired, then recovers. Recoil follows a fixed per-weapon pattern that climbs and walks
left and right, and it springs back when you stop shooting: hold the trigger and the crosshair
ends up in the sky, tap and the round goes where the crosshair is. Damage falls off with range,
headshots multiply it, and kevlar eats half of a body hit until it is shredded.

Bots use the same ballistics. They see through a field of view and a line-of-sight test, react
after a human-ish delay, shoot inside a cone that settles the longer they hold you, and pick
lanes, holds and the site over a navigation grid.

## Layout

```
game/
  index.html        the page, the import map and the HUD markup
  style.css         the whole interface (no fonts or images fetched)
  favicon.svg
  src/
    config.js       every tunable: weapons, economy, movement, bot skill, round clock
    physics.js      AABB tracing, circle-vs-box collision, ground support
    map.js          Foundry 9: geometry, procedural textures, lights, spawns, holds
    nav.js          grid + A* + path smoothing
    combat.js       loadouts, spread/recoil model, hitboxes, damage
    player.js       movement, view model, firing, recoil, spectate-ready body
    bots.js         perception, engagements, objective roles, plant and defuse
    round.js        the match: phases, money, the charge, win conditions, payouts
    hud.js          HUD binding, buy menu, kill feed, scoreboard, end screens
    effects.js      pooled tracers, sparks, decals, muzzle flash, particles
    audio.js        WebAudio synthesis: guns, footsteps, the charge, the yard
    main.js         renderer, loop, input, menus
    capture.js      screenshot staging, only loaded with ?shot=... (dev tooling)
  vendor/three/     three.js 0.187.0, byte for byte
```

## Hand-in

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the kit's
`buildDossier`. Screenshots are captured from the running game with `tools/capture.py` (writes the
four `screenshots/*.jpg` from the `?shot=` hooks).

## Licence

MIT — see `LICENSE`. three.js is MIT and vendored unmodified under `game/vendor/three/`.
