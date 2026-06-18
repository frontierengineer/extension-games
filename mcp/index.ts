import type { McpProvider, Store, Http, ToolResult } from '../../types';
import {
  CONSOLES, consoleSpec, archiveDownloadUrl, type Catalog,
} from '../consoles';
import {
  metaKey, romKey, catalogKey, commandKey, COMMANDS_PREFIX,
  type SavedGame, type GameCommand,
} from '../storage';
import { fetchCatalogEntries } from './catalog';

// Host-side games capability. The browser ui/ can't fetch ROMs itself — the
// archive.org file responses don't send CORS headers — so the ui drops a
// command marker in the store and we do the fetch here (over services.http,
// which is allowlisted to archive.org in extension.json and SSRF-guarded) and
// build the catalog. This is the same store-as-channel pattern spaces uses.

const CATALOG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // rebuild a catalog monthly

async function readGame(store: Store, id: string): Promise<SavedGame | null> {
  const raw = await store.get(metaKey(id)).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw) as SavedGame; } catch { return null; }
}

async function writeGame(store: Store, game: SavedGame): Promise<void> {
  await store.put(metaKey(game.id), JSON.stringify(game, null, 2));
}

async function readCatalog(store: Store, console: string): Promise<Catalog | null> {
  const raw = await store.get(catalogKey(console)).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw) as Catalog; } catch { return null; }
}

async function downloadRom(http: Http, url: string): Promise<Uint8Array> {
  const res = await http.fetch(url, { responseType: 'bytes', timeoutMs: 120_000 });
  if (res.status < 200 || res.status >= 300) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(res.body, 'base64');
  if (buf.length === 0) throw new Error('downloaded file was empty');
  return new Uint8Array(buf);
}

export function register(mcpProvider: McpProvider): void {
  const mcp = mcpProvider.version(1);
  const store: Store = mcp.services.store;
  const http: Http = mcp.services.http;

  const installing = new Set<string>();
  const buildingCatalog = new Set<string>();

  // ── Fetch one library game's ROM and attach it ──────────────────
  async function installGame(gameId: string): Promise<void> {
    if (installing.has(gameId)) return;
    installing.add(gameId);
    try {
      const game = await readGame(store, gameId);
      if (!game || game.hasRom || !game.source) return;
      const spec = consoleSpec(game.source.console);
      if (!spec) {
        await writeGame(store, { ...game, fetch: { state: 'error', error: `unknown console ${game.source.console}` } });
        return;
      }
      await writeGame(store, { ...game, fetch: { state: 'fetching' } });
      try {
        const bytes = await downloadRom(http, archiveDownloadUrl(spec.archiveItem, game.source.file));
        await store.putBytes(romKey(gameId), Buffer.from(bytes));
        await writeGame(store, { ...game, hasRom: true, fetch: { state: 'ready' } });
        console.log(`[games] installed ${gameId} (${bytes.length}B)`);
      } catch (err: any) {
        await writeGame(store, { ...game, fetch: { state: 'error', error: err?.message || String(err) } });
        console.error(`[games] install ${gameId} failed:`, err?.message || err);
      }
    } finally {
      installing.delete(gameId);
    }
  }

  // ── Build (or refresh) a console's searchable catalog ────────────
  async function buildCatalog(consoleId: string, force = false): Promise<Catalog | null> {
    const spec = consoleSpec(consoleId);
    if (!spec) return null;
    if (buildingCatalog.has(consoleId)) return null;
    const existing = await readCatalog(store, consoleId);
    const fresh = existing?.games && existing.builtAt && (Date.now() - Date.parse(existing.builtAt) < CATALOG_TTL_MS);
    if (fresh && !force) return existing;
    buildingCatalog.add(consoleId);
    try {
      let catalog: Catalog;
      try {
        const games = await fetchCatalogEntries(http, spec.archiveItem);
        catalog = { builtAt: new Date().toISOString(), item: spec.archiveItem, games };
        console.log(`[games] built ${consoleId} catalog: ${games.length} games`);
      } catch (err: any) {
        catalog = { builtAt: new Date().toISOString(), item: spec.archiveItem, error: err?.message || String(err) };
        console.error(`[games] catalog build ${consoleId} failed:`, err?.message || err);
      }
      await store.put(catalogKey(consoleId), JSON.stringify(catalog));
      return catalog;
    } finally {
      buildingCatalog.delete(consoleId);
    }
  }

  // ── Command queue (drained on watch + boot; markers deleted first) ──
  let draining = false;
  let drainAgain = false;
  async function drainCommands(): Promise<void> {
    if (draining) { drainAgain = true; return; }
    draining = true;
    try {
      let keys: string[];
      try { keys = await store.list(COMMANDS_PREFIX); } catch { return; }
      for (const key of keys) {
        if (!key.endsWith('.json')) continue;
        let cmd: GameCommand | null = null;
        try {
          const raw = await store.get(key);
          cmd = raw ? (JSON.parse(raw) as GameCommand) : null;
        } catch { cmd = null; }
        await store.delete(key).catch(() => {});
        if (!cmd) continue;
        try {
          if (cmd.kind === 'install') await installGame(cmd.gameId);
          else if (cmd.kind === 'buildCatalog') await buildCatalog(cmd.console);
        } catch (err: any) {
          console.error(`[games] command ${cmd.kind} failed:`, err?.message || err);
        }
      }
    } finally {
      draining = false;
      if (drainAgain) { drainAgain = false; void drainCommands(); }
    }
  }

  store.watch(COMMANDS_PREFIX, () => { void drainCommands(); });
  void drainCommands();

  // ── MCP tool: let the agent install a game by name ──────────────
  mcp.registerTool({
    name: 'install_game',
    title: 'Install Game',
    description:
      'Install a console game so the user can play it. Picks the best catalog match for `query` on `console` ' +
      'and downloads it. Consoles: ' + CONSOLES.map((c) => c.id).join(', ') + '.',
    inputSchema: {
      type: 'object',
      properties: {
        console: { type: 'string', description: 'Console id: ' + CONSOLES.map((c) => c.id).join(', ') },
        query: { type: 'string', description: 'Game title to search for, e.g. "super mario world"' },
      },
      required: ['console', 'query'],
    },
    handler: async (args: { console?: string; query?: string }): Promise<ToolResult> => {
      const consoleId = String(args.console || '').trim();
      const query = String(args.query || '').trim();
      const spec = consoleSpec(consoleId);
      if (!spec) return toText(`Unknown console "${consoleId}". Try one of: ${CONSOLES.map((c) => c.id).join(', ')}.`, true);
      if (!query) return toText('Provide a game title to search for.', true);

      const catalog = await buildCatalog(consoleId);
      const games = catalog?.games || [];
      if (games.length === 0) return toText(`Couldn't load the ${spec.label} catalog (${catalog?.error || 'unknown error'}).`, true);

      const q = query.toLowerCase();
      const matches = games.filter((g) => g.title.toLowerCase().includes(q));
      const pick = matches.sort((a, b) => a.title.length - b.title.length)[0];
      if (!pick) return toText(`No ${spec.label} game matched "${query}".`, true);

      const id = await createGameMeta(store, pick.title, consoleId, pick.file);
      await installGame(id);
      const after = await readGame(store, id);
      if (after?.fetch?.state === 'error') return toText(`Found "${pick.title}" but the download failed: ${after.fetch.error}`, true);
      return toText(`Installed "${pick.title}" (${spec.label}). Open it from the Games sidebar to play.`);
    },
  });
}

const toText = (text: string, isError = false): ToolResult => ({ content: [{ type: 'text', text }], isError });

function slugify(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}

async function createGameMeta(store: Store, name: string, consoleId: string, file: string): Promise<string> {
  const base = slugify(name);
  let id = base;
  let n = 2;
  while (await store.get(metaKey(id))) id = `${base}-${n++}`;
  const game: SavedGame = { id, name, console: consoleId, hasRom: false, source: { console: consoleId, file }, fetch: { state: 'pending' } };
  await store.put(metaKey(id), JSON.stringify(game, null, 2));
  return id;
}
