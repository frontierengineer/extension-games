import type { Store } from '../../types';
import { DEFAULT_CONSOLE, type Catalog } from './constants';
import {
  metaKey, romKey, saveKey, stateKey, catalogKey, commandKey, isGameMetaKey, GAMES_PREFIX,
  type SavedGame, type GameCommand,
} from '../storage';

export type { SavedGame } from '../storage';

function slugify(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}

function normalize(parsed: Partial<SavedGame>, fallbackId: string): SavedGame {
  return {
    id: parsed.id || fallbackId,
    name: parsed.name || parsed.id || fallbackId,
    console: parsed.console || DEFAULT_CONSOLE,
    hasRom: !!parsed.hasRom,
    source: parsed.source,
    fetch: parsed.fetch,
  };
}

export async function listGames(store: Store): Promise<SavedGame[]> {
  const out: SavedGame[] = [];
  for (const key of await store.list(GAMES_PREFIX)) {
    if (!isGameMetaKey(key)) continue;
    const raw = await store.get(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<SavedGame>;
      out.push(normalize(parsed, key.slice(GAMES_PREFIX.length + 1, -'.json'.length)));
    } catch {
      /* skip a corrupt entry rather than break the whole list */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function getGame(store: Store, id: string): Promise<SavedGame | null> {
  const raw = await store.get(metaKey(id));
  if (!raw) return null;
  try { return normalize(JSON.parse(raw) as Partial<SavedGame>, id); } catch { return null; }
}

async function writeGame(store: Store, game: SavedGame): Promise<void> {
  await store.put(metaKey(game.id), JSON.stringify(game, null, 2));
}

async function freshId(store: Store, name: string): Promise<string> {
  const base = slugify(name);
  let id = base;
  let n = 2;
  while (await store.get(metaKey(id))) id = `${base}-${n++}`;
  return id;
}

// Create an empty "bring your own ROM" game (no source — the user uploads bytes).
export async function createGame(store: Store, opts: { name: string; console: string }): Promise<SavedGame> {
  const name = (opts.name || '').trim() || 'New game';
  const game: SavedGame = { id: await freshId(store, name), name, console: opts.console || DEFAULT_CONSOLE, hasRom: false };
  await writeGame(store, game);
  return game;
}

// Create a library game (download pending) and drop the install command for the
// host to fulfil. Returns the new game; the view watches it flip to ready.
export async function installFromCatalog(
  store: Store,
  opts: { name: string; console: string; file: string },
): Promise<SavedGame> {
  const game: SavedGame = {
    id: await freshId(store, opts.name),
    name: opts.name,
    console: opts.console,
    hasRom: false,
    source: { console: opts.console, file: opts.file },
    fetch: { state: 'pending' },
  };
  await writeGame(store, game);
  await dropCommand(store, { kind: 'install', gameId: game.id });
  return game;
}

// Re-queue a failed install.
export async function retryInstall(store: Store, id: string): Promise<void> {
  const game = await getGame(store, id);
  if (!game) return;
  await writeGame(store, { ...game, fetch: { state: 'pending' } });
  await dropCommand(store, { kind: 'install', gameId: id });
}

export async function deleteGame(store: Store, id: string): Promise<void> {
  await store.delete(metaKey(id));
  await store.delete(romKey(id));
  await store.delete(saveKey(id));
  await store.delete(stateKey(id));
}

export async function putRom(store: Store, id: string, bytes: Uint8Array): Promise<void> {
  await store.putBytes(romKey(id), bytes);
  const game = await getGame(store, id);
  if (game && !game.hasRom) await writeGame(store, { ...game, hasRom: true });
}

// Copy into a standalone Uint8Array (its own ArrayBuffer) so the emulator gets
// a clean byte view, not one aliasing a larger backing buffer.
function standalone(bytes: Uint8Array | null): Uint8Array | null {
  if (!bytes) return null;
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

export async function getRom(store: Store, id: string): Promise<Uint8Array | null> {
  return standalone(await store.getBytes(romKey(id)));
}

export async function putSave(store: Store, id: string, bytes: Uint8Array): Promise<void> {
  await store.putBytes(saveKey(id), bytes);
}

export async function getSave(store: Store, id: string): Promise<Uint8Array | null> {
  return standalone(await store.getBytes(saveKey(id)));
}

export async function putState(store: Store, id: string, bytes: Uint8Array): Promise<void> {
  await store.putBytes(stateKey(id), bytes);
}

export async function getState(store: Store, id: string): Promise<Uint8Array | null> {
  return standalone(await store.getBytes(stateKey(id)));
}

// ── Catalog (built by the host; read here) ───────────────────────────

export async function getCatalog(store: Store, consoleId: string): Promise<Catalog | null> {
  const raw = await store.get(catalogKey(consoleId));
  if (!raw) return null;
  try { return JSON.parse(raw) as Catalog; } catch { return null; }
}

export async function requestCatalog(store: Store, consoleId: string): Promise<void> {
  await dropCommand(store, { kind: 'buildCatalog', console: consoleId });
}

let commandSeq = 0;
async function dropCommand(store: Store, cmd: GameCommand): Promise<void> {
  const rid = `${Date.now().toString(36)}-${(commandSeq++).toString(36)}`;
  await store.put(commandKey(rid), JSON.stringify(cmd));
}
