import type { HostProvider, HostDaemonHost, Store, Http, ToolResult } from '../../types';
import {
  CONSOLES, consoleSpec, archiveDownloadUrl, type Catalog,
} from '../consoles';
import {
  metaKey, romKey, catalogKey, commandKey, COMMANDS_PREFIX,
  type SavedGame, type GameCommand,
} from '../storage';
import { fetchCatalogEntries, httpStatusHint, shortUrl } from './catalog';

// Host-side games capability. The browser surface/ can't fetch ROMs itself — the
// archive.org file responses don't send CORS headers — so the surface drops a
// command marker in the store and we do the fetch here (over host.http, which is
// allowlisted to archive.org in extension.json and SSRF-guarded) and build the
// catalog. This is the same store-as-channel pattern spaces uses.

const CATALOG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // rebuild a catalog monthly

async function readGame(store: Store, id: string): Promise<SavedGame | null> {
  // store.getJson resolves ok(null) for a missing key, so a catch here would only
  // mask a real store fault as "no such game"; let the boundary see it instead.
  const r = await store.getJson<SavedGame>(metaKey(id));
  if (!r.ok || r.value === null) return null;
  return r.value;
}

async function writeGame(store: Store, game: SavedGame): Promise<void> {
  await store.putJson({ key: metaKey(game.id), value: game });
}

async function readCatalog(store: Store, console: string): Promise<Catalog | null> {
  // As in readGame: absence already reads back as ok(null), so catching here would
  // only bury a store fault behind "no catalog yet".
  const r = await store.getJson<Catalog>(catalogKey(console));
  if (!r.ok || r.value === null) return null;
  return r.value;
}

async function downloadRom(http: Http, url: string): Promise<Uint8Array> {
  let res;
  try {
    res = await http.fetch({ url, method: null, headers: null, body: null, timeoutMs: 120_000, responseType: 'bytes' });
  } catch (err: any) {
    // A THROWN error is our network/guard layer, NOT an archive.org status:
    // a timeout, the 64MB response cap (large N64/GBA ROMs), the SSRF/allowlist
    // guard, or DNS. Name the file + add a hint so our limit is distinguishable
    // from an archive.org failure.
    const msg = err?.message || String(err);
    let hint = '';
    if (/byte cap/.test(msg)) hint = ' — this ROM is larger than the download size limit';
    else if (/timed out/.test(msg)) hint = ' — the download timed out (a large ROM over a slow link may need a retry)';
    else if (/allowed network hosts|internal\/non-routable/.test(msg)) hint = ' — the download host is blocked by this extension\'s network allowlist';
    throw new Error(`couldn't fetch ${shortUrl(url)}: ${msg}${hint}`);
  }
  // `res.url` is the FINAL hop after archive.org's 302 to a data node — name it
  // (not the /download/ handle) so the failing host is the real one.
  const where = shortUrl(res.url || url);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`archive.org returned HTTP ${res.status} for ${where} — ${httpStatusHint(res.status)}`);
  }
  const buf = Buffer.from(res.body, 'base64');
  if (buf.length === 0) throw new Error(`archive.org returned an empty file for ${where}`);
  return new Uint8Array(buf);
}

export function register(hostProvider: HostProvider): void {
  const h = hostProvider.version(1);
  // The host bundle is a single daemon: all logic and capability live inside its
  // mount(), which receives the flat HostDaemonHost and returns the teardown.
  h.daemon.register({ mount });
}

// The games daemon. Drains the surface's store-queued commands (install a ROM,
// build a catalog) and registers the install_game MCP tool, all over the flat
// host handed at mount. Returns a dispose that drops the store watch at unload.
function mount(host: HostDaemonHost): { dispose?: () => void } {
  const store: Store = host.store;
  const http: Http = host.http;

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
      const romUrl = archiveDownloadUrl(spec.archiveItem, game.source.file);
      console.log(`[games] downloading ${gameId} from ${shortUrl(romUrl)}`);
      try {
        const bytes = await downloadRom(http, romUrl);
        await store.putBytes({ key: romKey(gameId), value: Buffer.from(bytes) });
        await writeGame(store, { ...game, hasRom: true, fetch: { state: 'ready' } });
        console.log(`[games] installed ${gameId} (${bytes.length}B)`);
      } catch (err: any) {
        const error = err?.message || String(err);
        await writeGame(store, { ...game, fetch: { state: 'error', error } });
        console.error(`[games] install ${gameId} failed: ${error}`);
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
      await store.putJson({ key: catalogKey(consoleId), value: catalog });
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
      try { keys = (await store.list(COMMANDS_PREFIX)).keys; }
      catch (err: any) { console.error('[games] draining commands failed to list:', err?.message || err); return; }
      for (const key of keys) {
        if (!key.endsWith('.json')) continue;
        let cmd: GameCommand | null = null;
        try {
          const r = await store.getJson<GameCommand>(key);
          cmd = r.ok ? r.value : null;
        } catch { cmd = null; }
        // Consume the marker first so a failing command can't wedge the queue.
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

  const watch = store.watch(COMMANDS_PREFIX, () => { void drainCommands(); });
  void drainCommands();

  // ── MCP tool: let the agent install a game by name ──────────────
  host.mcp.registerTool({
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
      // Wrap the WHOLE body: an unhandled rejection here (a store/IO hiccup, an
      // archive.org edge) would escape the MCP registry — which calls the handler
      // without a guard — and surface to the caller as an opaque
      // `500 mcp handler error`. Convert ANY throw to a clear, isError ToolResult
      // so the agent always gets a legible reason, never a bare 500.
      try {
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
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.error(`[games] install_game failed: ${msg}`);
        return toText(`Couldn't install that game: ${msg}`, true);
      }
    },
  });

  // The daemon's only teardown: drop the store watch when the extension unloads.
  return { dispose: () => watch.unsubscribe() };
}

const toText = (text: string, isError = false): ToolResult => ({ content: [{ type: 'text', text }], isError });

function slugify(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}

async function createGameMeta(store: Store, name: string, consoleId: string, file: string): Promise<string> {
  const base = slugify(name);
  let id = base;
  let n = 2;
  while ((await store.getString(metaKey(id))).value) id = `${base}-${n++}`;
  const game: SavedGame = { id, name, console: consoleId, hasRom: false, source: { console: consoleId, file }, fetch: { state: 'pending' } };
  await store.putJson({ key: metaKey(id), value: game });
  return id;
}
