// Hand-in program for the IRONSIGHT entry (Node 22, standard library only).
//
// The playable thing is game/: static files the browser loads as ES modules, with three.js
// resolved by the page's import map to the vendored module. This program copies game/ and
// screenshots/ next to itself into the output directory (the grader's /output, or
// MAKEFUN_OUTPUT_DIR when run outside the container) and writes dossier.json there with the
// kit's own buildDossier, using the same caps the scorer's gate.json holds.
//
// Play it locally with `node serve.ts` and open http://localhost:8080.
// Produce the hand-in locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// Same caps as the bounty's gate.json: only text_max_bytes shapes the dossier's bytes; the rest
// refuse an entry the scorer would refuse (more than 4 shots or one over 256 KiB, more than 993
// entries or 48 MiB under game/, and the 1000-entry cap on /output counting both).
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
