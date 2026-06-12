// build-check.mjs — esbuild every entry the way the Frontier host does, to
// prove the extension actually bundles before publishing. Mirrors the host's
// backend/extensions/bundler.ts:
//   • ui/index.tsx        → browser ESM, jsx automatic, CSS + binary assets
//                           loaded the host's way (react/react-dom +
//                           @frontierengineer/ui marked external here so the
//                           check needs no vendored copy; the host aliases
//                           @frontierengineer/ui to its frontend tree and pins
//                           react to ui/node_modules instead).
//   • server|worker|mcp|hooks/index.ts → node CJS (node built-ins external;
//                           type-only `../../types` imports are erased).
//
// Capabilities import the contract as `../../types` (the production specifier).
// esbuild won't alias a relative key, and in a flat repo `../../` escapes above
// the root — so we resolve entries through the SAME production-nested mirror
// verify.mjs builds (.verify/games/<cap>/index.ts), where `../../types` points
// at a real sibling file. ensureMirror() builds it if it's not already there
// (so this script also runs standalone).
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mirror = path.join(root, '.verify');
const id = 'games';
const extDir = path.join(mirror, id);

function ensureMirror() {
  if (fs.existsSync(extDir)) return false; // already built by caller
  fs.mkdirSync(mirror, { recursive: true });
  for (const f of ['types.ts', 'workspaceTypes.ts']) {
    fs.symlinkSync(path.join(root, f), path.join(mirror, f));
  }
  fs.symlinkSync(root, extDir, 'dir');
  return true;
}

const browserEntry = { entry: 'ui/index.tsx', label: 'ui (browser)' };
const HOST_CAPS = ['server', 'worker', 'mcp', 'hooks'];
const nodeEntries = HOST_CAPS
  .filter((c) => fs.existsSync(path.join(root, c, 'index.ts')))
  .map((c) => ({ entry: `${c}/index.ts`, label: `${c} (node)` }));

// react/react-dom + @frontierengineer/ui are resolved by the host (its frontend
// tree / the capability's node_modules); for a pure resolution + syntax check
// we mark them external so no install of them is required. zustand subpaths
// likewise — the host bundles the extension's own copy.
const browserExternal = [
  'react', 'react-dom', 'react-dom/client', '@frontierengineer/ui',
  'zustand', 'zustand/*',
];

async function buildBrowser() {
  await esbuild.build({
    entryPoints: [path.join(extDir, browserEntry.entry)],
    bundle: true,
    write: false,
    outdir: extDir, // CSS + assets need an output path even with write:false
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    preserveSymlinks: true, // resolve `../../types` against the mirror, not the symlink target
    external: browserExternal,
    // The host loads `import './styles.css'` and binary assets as data URLs; a
    // ui that imports CSS won't bundle without these (matches bundler.ts).
    loader: {
      '.css': 'css',
      '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.eot': 'dataurl',
      '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.gif': 'dataurl',
    },
    logLevel: 'silent',
  });
  console.log(`OK  ${browserEntry.label}`);
}

async function buildNode({ entry, label }) {
  await esbuild.build({
    entryPoints: [path.join(extDir, entry)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node16',
    preserveSymlinks: true,
    logLevel: 'silent',
  });
  console.log(`OK  ${label}`);
}

const owned = ensureMirror();
try {
  await buildBrowser();
  for (const e of nodeEntries) await buildNode(e);
  console.log('\nAll entries bundle cleanly.');
} catch (err) {
  console.error('\nbuild-check FAILED:\n', err.message || err);
  process.exitCode = 1;
} finally {
  if (owned) fs.rmSync(mirror, { recursive: true, force: true });
}
