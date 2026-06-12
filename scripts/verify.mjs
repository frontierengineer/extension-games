// verify.mjs — prove the extension COMPILES and BUNDLES, exactly as the host
// would.
//
// The catch: every capability imports the contract as `../../types` — the
// specifier real (installed) extensions use. In the host, an extension lives at
// <FRONTIER_DIR>/extensions/<id>/, so `../../types` resolves to the host-written
// extensions/types.ts one level ABOVE the extension. This repo is a FLAT
// standalone extension (extension.json at the root), so `../../` from a
// capability would escape above the repo — there is no real file there to
// typecheck against, and TypeScript will not remap a relative specifier.
//
// So we reproduce the production directory shape in a temp mirror:
//
//     .verify/
//       types.ts            (← the repo's vendored host contract, as a sibling —
//       workspaceTypes.ts      mirrors extensions/types.ts the host writes)
//       games/              (← a symlink to this repo = the <id> dir)
//
// `../../types` (the HOST contract) resolves up to .verify/types.ts — the
// production position. The mcp half reaches the extension's own root files via
// `../consoles` / `../storage` (inside the repo); the ui imports
// `@frontierengineer/ui` (the host's shared primitives), which the host bundler
// aliases to its frontend tree — for the local typecheck we point it at the
// vendored hostUi.d.ts shim via `paths`. We run tsc from the mirror (host-side
// + ui), then esbuild every entry the way the bundler does. The mirror is
// throwaway (.gitignored); the committed source stays a clean, flat,
// production-faithful extension.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mirror = path.join(root, '.verify');
const id = 'games';

const HOST_CAPS = ['server', 'worker', 'mcp', 'hooks'];
const presentHostCaps = HOST_CAPS.filter((c) => fs.existsSync(path.join(root, c, 'index.ts')));

function run(label, file, args) {
  process.stdout.write(`• ${label} … `);
  try {
    execFileSync(file, args, { cwd: root, stdio: 'pipe' });
    console.log('OK');
  } catch (err) {
    console.log('FAILED');
    process.stderr.write((err.stdout?.toString() || '') + (err.stderr?.toString() || '') + '\n');
    process.exitCode = 1;
  }
}

// ── Build the production-shaped mirror ─────────────────────────────────────
fs.rmSync(mirror, { recursive: true, force: true });
fs.mkdirSync(mirror, { recursive: true });
for (const f of ['types.ts', 'workspaceTypes.ts']) {
  fs.symlinkSync(path.join(root, f), path.join(mirror, f));
}
fs.symlinkSync(root, path.join(mirror, id), 'dir');

const tsc = path.join(root, 'node_modules', '.bin', 'tsc');

// UI typecheck: extend the repo's ui tsconfig, map `@frontierengineer/ui` to the
// vendored shim (the host aliases it to its frontend tree at build time).
const uiTsconfig = path.join(mirror, 'tsconfig.ui.json');
fs.writeFileSync(uiTsconfig, JSON.stringify({
  extends: `./${id}/ui/tsconfig.json`,
  compilerOptions: {
    baseUrl: '.',
    paths: { '@frontierengineer/ui': [`./${id}/hostUi.d.ts`] },
  },
  include: [`${id}/ui/index.tsx`],
}, null, 2));

// ── Run the checks ─────────────────────────────────────────────────────────
console.log('Verifying games (production-nested mirror in .verify/):\n');
if (presentHostCaps.length) {
  // Host-side halves share the repo's root tsconfig (CJS + node + DOM, noEmit).
  const hostTsconfig = path.join(mirror, 'tsconfig.host.json');
  fs.writeFileSync(hostTsconfig, JSON.stringify({
    extends: `./${id}/tsconfig.json`,
    include: presentHostCaps.map((c) => `${id}/${c}/**/*.ts`),
  }, null, 2));
  run('typecheck  host-side (' + presentHostCaps.join('/') + ')', tsc, ['--noEmit', '-p', hostTsconfig]);
}
run('typecheck  ui (browser)', tsc, ['--noEmit', '-p', uiTsconfig]);
run('bundle     all entries (esbuild, host settings)', process.execPath, [path.join(root, 'scripts', 'build-check.mjs')]);

fs.rmSync(mirror, { recursive: true, force: true });
console.log(process.exitCode ? '\nVERIFY FAILED' : '\nVERIFY OK — compiles and bundles.');
