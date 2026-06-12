import { create } from 'zustand';
import type { Store } from '../../types';
import type { Catalog } from './constants';
import type { SavedGame } from './data';
import {
  listGames, createGame, installFromCatalog, retryInstall, deleteGame,
  putRom, getRom, putSave, getSave, putState, getState, getCatalog, requestCatalog,
} from './data';

interface RootState {
  list: SavedGame[];
  loaded: boolean;
}

const useRoot = create<RootState>(() => ({ list: [], loaded: false }));

let store: Store | null = null;

export function initGames(s: Store): void {
  if (store) return;
  store = s;
  s.watch('games', () => { void gamesApi.fetchList(); });
}

export interface GamesApi {
  list: SavedGame[];
  loaded: boolean;
  fetchList: () => Promise<void>;
  createGame: (opts: { name: string; console: string }) => Promise<SavedGame>;
  installFromCatalog: (opts: { name: string; console: string; file: string }) => Promise<SavedGame>;
  retryInstall: (id: string) => Promise<void>;
  deleteGame: (id: string) => Promise<void>;
  putRom: (id: string, bytes: Uint8Array) => Promise<void>;
  getRom: (id: string) => Promise<Uint8Array | null>;
  putSave: (id: string, bytes: Uint8Array) => Promise<void>;
  getSave: (id: string) => Promise<Uint8Array | null>;
  putState: (id: string, bytes: Uint8Array) => Promise<void>;
  getState: (id: string) => Promise<Uint8Array | null>;
  getCatalog: (consoleId: string) => Promise<Catalog | null>;
  requestCatalog: (consoleId: string) => Promise<void>;
  watch: (prefix: string, handler: () => void) => () => void;
}

function need(): Store {
  if (!store) throw new Error('Games store not initialized');
  return store;
}

const gamesApi: GamesApi = {
  get list() { return useRoot.getState().list; },
  get loaded() { return useRoot.getState().loaded; },
  fetchList: async () => {
    if (!store) return;
    try {
      useRoot.setState({ list: await listGames(store), loaded: true });
    } catch {
      useRoot.setState({ loaded: true });
    }
  },
  createGame: async (opts) => {
    const game = await createGame(need(), opts);
    await gamesApi.fetchList();
    return game;
  },
  installFromCatalog: async (opts) => {
    const game = await installFromCatalog(need(), opts);
    await gamesApi.fetchList();
    return game;
  },
  retryInstall: async (id) => { await retryInstall(need(), id); },
  deleteGame: async (id) => {
    await deleteGame(need(), id);
    await gamesApi.fetchList();
  },
  putRom: async (id, bytes) => {
    await putRom(need(), id, bytes);
    await gamesApi.fetchList();
  },
  getRom: async (id) => getRom(need(), id),
  putSave: async (id, bytes) => putSave(need(), id, bytes),
  getSave: async (id) => getSave(need(), id),
  putState: async (id, bytes) => putState(need(), id, bytes),
  getState: async (id) => getState(need(), id),
  getCatalog: async (consoleId) => getCatalog(need(), consoleId),
  requestCatalog: async (consoleId) => requestCatalog(need(), consoleId),
  watch: (prefix, handler) => need().watch(prefix, handler),
};

export function useGames<T>(selector: (api: GamesApi) => T): T {
  return useRoot((root) => {
    void root.list;
    void root.loaded;
    return selector(gamesApi);
  });
}

export function useGamesRaw(): GamesApi {
  return gamesApi;
}
