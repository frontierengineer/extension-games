// The store contract shared by the browser ui/ and the host mcp/ capability.
// Both reach the SAME per-extension key/value store ("games" namespace), so
// these key helpers and record shapes are the wire format between them — the ui
// writes a request, the host fulfils it. Keeping them in one (import-free) file
// guarantees the two sides never drift. See mcp/index.ts for the fulfilment.

export const GAMES_PREFIX = 'games';
export const CATALOG_PREFIX = 'catalog';
export const COMMANDS_PREFIX = 'commands';

export const metaKey = (id: string): string => `${GAMES_PREFIX}/${id}.json`;
export const romKey = (id: string): string => `${GAMES_PREFIX}/${id}/rom.bin`;
export const saveKey = (id: string): string => `${GAMES_PREFIX}/${id}/save.bin`;
export const stateKey = (id: string): string => `${GAMES_PREFIX}/${id}/state.bin`;
export const catalogKey = (consoleId: string): string => `${CATALOG_PREFIX}/${consoleId}.json`;
export const commandKey = (rid: string): string => `${COMMANDS_PREFIX}/${rid}.json`;

// A game's meta lives at the top level (games/<id>.json); its ROM, battery
// save, and save state live one level deeper (games/<id>/*.bin). Only the
// top-level .json files are games — guard list walks so the nested blobs are
// never read as a game.
export function isGameMetaKey(key: string): boolean {
  return key.endsWith('.json') && !key.slice(GAMES_PREFIX.length + 1).includes('/');
}

export type FetchState = 'pending' | 'fetching' | 'ready' | 'error';

// Where a library game's ROM comes from: the console + the archive.org filename
// (the download handle). Absent on a "bring your own ROM" game.
export interface GameSource {
  console: string;
  file: string;
}

export interface GameFetch {
  state: FetchState;
  error?: string;
}

export interface SavedGame {
  id: string;
  name: string;
  console: string;
  hasRom: boolean;
  source?: GameSource;
  fetch?: GameFetch;
}

// Markers the ui drops under commands/ for the host to act on, then delete.
export type GameCommand =
  | { kind: 'install'; gameId: string }
  | { kind: 'buildCatalog'; console: string };
