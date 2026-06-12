# Games — a retro console emulator for Frontier

Games turns Frontier into a retro arcade. It runs classic consoles in the browser via EmulatorJS, browses public ROM catalogs hosted on archive.org, and plays the games right inside a tab — and you can bring your own ROMs too. The sidebar is your library; opening a title launches the emulator view; a welcome tile gets you to the library in one click.

It has two halves. The `ui/` half is the whole player: the library, the emulator surface, save handling, and the catalog browser. The `mcp/` half is a small host-side helper — it exposes an `install_game` tool an AI agent can call, and (because archive.org's file responses don't send CORS headers) it does the catalog fetches the browser can't, over the host's `services.http.fetch`, which `extension.json` allowlists to `archive.org` and the host SSRF-guards. The browser drops a command marker in the extension Store and the mcp half fulfills it — the same store-as-channel pattern the rest of Frontier uses. There's no server, worker, or hooks component.

## What's in here

- `ui/index.tsx` — the entry: registers the library and game views, the sidebar, the `games.library` / `games.new` commands, and a welcome tile.
- `ui/components/` — the React surface: the library grid, the game view, the EmulatorView wrapper, and the sidebar list.
- `ui/emulator.ts` / `ui/useGamesStore.ts` / `ui/data.ts` — the EmulatorJS integration and a Zustand store over the host Store.
- `mcp/index.ts` / `mcp/catalog.ts` — the host-side `install_game` MCP tool and the archive.org catalog fetcher.
- `consoles.ts` / `storage.ts` — shared root files (console specs + archive URLs, and the Store key scheme) imported by both halves as `../consoles` / `../storage`.
- `extension.json` — `displayName`, `defaultColor`, `description`, and `network.allowedHosts: ["archive.org"]` (the one outbound host it needs; shown in the install trust dialog). No schema version: Games has no server-side migration.

## How types resolve (important for a standalone repo)

Every capability imports the host contract as `import type … from '../../types'` — the exact specifier an installed extension uses. In production the host copies the extension into `<FRONTIER_DIR>/extensions/<id>/` and writes a `types.ts` shim one level up (a sibling of every extension), so `../../types` from `mcp/index.ts` or `ui/index.tsx` resolves to `extensions/types.ts`, and `../../../types` from a file under `ui/components/` resolves to the same place. Each half's OWN shared files sit at the repo root and are reached one level up from a capability — `mcp/index.ts` imports `../consoles` and `../storage` — note the different depth: `../../types` is the host's file two levels up, `../consoles` is this extension's file one level up. This repo is a flat, standalone extension (the `extension.json` is at the root), so there is no host beside it and `../../` from a capability would point above the repo. To stay byte-identical to an installed extension, the contract is vendored at the repo root — [`types.ts`](./types.ts) (a verbatim copy of the host's `backend/extensions/types.ts`, plus a one-block header) and [`workspaceTypes.ts`](./workspaceTypes.ts) (its one dependency). The imports are type-only, so esbuild erases them from the shipped bundles — nothing vendored ends up at runtime. To keep current with the host, re-copy those two files when the API moves.

The ui also imports `usePreviewClick` from `@frontierengineer/ui`, the host's shared UI primitives. The host bundler aliases that specifier to its own frontend tree at build time, so the bytes never ship here; for the local typecheck the surface this extension uses is declared in [`hostUi.d.ts`](./hostUi.d.ts), pointed at via `paths` in the verify mirror's ui tsconfig and marked external for esbuild.

Because TypeScript and esbuild won't remap a relative specifier, `npm run verify` reproduces the production directory nesting in a throwaway `.verify/` mirror (the vendored `types.ts` as a sibling of a `games` dir that symlinks this repo) and runs the checks from there — so `../../types` resolves exactly as the host resolves it, with no edits to the source.

## Verifying

```
npm install      # dev-only: TypeScript, esbuild, zustand, and @types for the local checks
npm run verify   # typecheck (host-side mcp + ui) against the production-nested mirror, then esbuild every entry the way the host's bundler does
```

`npm run verify` is the full gate; `npm run build:check` runs just the esbuild pass. None of this is needed to use the extension — the Frontier host builds the real bundles itself when it loads the extension; these scripts only let you confirm it compiles and bundles before you publish.

## Installing from the marketplace

Open the Extensions view in Frontier, switch to the Marketplace tab, find **Games**, and install. The install trust dialog will show that it requests outbound access to `archive.org` (for the ROM catalogs); approve to install. The host fetches the published tarball, verifies its pinned hash, installs it under `extensions/games/`, and the Games sidebar and library appear.

## Publishing

Publishing is open and unreviewed-by-humans: tag a release and the marketplace indexer picks it up. See the registry's [`PUBLISHING.md`](https://github.com/frontierengineer/extensions/blob/main/PUBLISHING.md). [`.github/workflows/release.yml`](./.github/workflows/release.yml) packs the extension into `extension.tgz` (minus `.git`, `.github`, `node_modules`, `data`, and the local-only `.verify`) and attaches it to a GitHub release; the registry then scans that exact tarball, pins its sha256 into `index.json`, and it's installable from the Marketplace tab.

```
git tag v1.0.0 && git push origin v1.0.0
```
