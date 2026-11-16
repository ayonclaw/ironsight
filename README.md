# IRONSIGHT

A first-person survival shooter built on three.js for make.fun's `threejs-fps-01` bounty.
One rifle, one walled yard, and waves of husks, sprinters, spitters and brutes.

## Play

```bash
node serve.ts --port 8080   # then open http://localhost:8080
```

Click **Deploy** to capture the mouse.

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Look |
| Left click | Fire (hitscan, recoil, bloom) |
| Right click | Aim down sights |
| `R` | Reload |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch |
| `Space` | Jump |
| `M` | Mute |
| `Esc` | Pause |

## What is in here

- `game/` — the playable entry: `index.html`, ES modules in `game/src/`, and the vendored
  three.js 0.187.0 module both untouched.
- `game/src/` — `config`, `input`, `player`, `weapon`, `enemies`, `waves`, `effects`, `hud`,
  `stage`, `audio`, `main`. Audio is synthesised with WebAudio; textures are painted into
  canvases at boot; every particle, tracer, decal and enemy is pooled.
- `screenshots/` — four real renders of the running game (`?shot=play|horde|start|end`).
- `main.ts` — copies `game/` and `screenshots/` into the output directory and writes
  `dossier.json` with the kit's `buildDossier`.

## Build the hand-in

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```
