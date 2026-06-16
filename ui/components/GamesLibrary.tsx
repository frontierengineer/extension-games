import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { usePreviewClick } from '@frontierengineer/ui';
import { useGames, useGamesRaw } from '../useGamesStore';
import { CONSOLES, DEFAULT_CONSOLE, consoleLabel, type Catalog } from '../constants';

const RENDER_CAP = 300; // keep the DOM light; search narrows the rest

export function GamesLibrary({
  navigate, onAddCustom,
}: {
  navigate: (path: string, opts?: { preview?: boolean }) => void;
  onAddCustom: () => void;
}): ReactElement {
  const api = useGamesRaw();
  const list = useGames((a) => a.list);
  const loaded = useGames((a) => a.loaded);
  const fetchList = useGames((a) => a.fetchList);

  const [consoleId, setConsoleId] = useState(DEFAULT_CONSOLE);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [busyFile, setBusyFile] = useState<string | null>(null);

  useEffect(() => { if (!loaded) void fetchList(); }, [loaded, fetchList]);

  const load = useCallback(async () => {
    const c = await api.getCatalog(consoleId);
    if (c?.games) { setCatalog(c); setStatus('ready'); return; }
    if (c?.error) { setCatalog(c); setStatus('error'); return; }
    setCatalog(null);
    setStatus('loading');
    await api.requestCatalog(consoleId);
  }, [api, consoleId]);

  // Reload when the console changes, and whenever the host writes a catalog.
  useEffect(() => { setQuery(''); setStatus('loading'); setCatalog(null); void load(); }, [load]);
  useEffect(() => api.watch('catalog', () => { void load(); }), [api, load]);

  // file → existing saved-game id, so a re-pick opens it instead of re-downloading.
  const installed = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of list) if (g.source && g.source.console === consoleId) m.set(g.source.file, g.id);
    return m;
  }, [list, consoleId]);

  const filtered = useMemo(() => {
    const games = catalog?.games || [];
    const q = query.trim().toLowerCase();
    const hits = q ? games.filter((g) => g.title.toLowerCase().includes(q)) : games;
    return { total: hits.length, shown: hits.slice(0, RENDER_CAP) };
  }, [catalog, query]);

  const install = async (file: string, title: string): Promise<void> => {
    setBusyFile(file);
    try {
      const game = await api.installFromCatalog({ name: title, console: consoleId, file });
      navigate(`/game/${game.id}`);
    } finally {
      setBusyFile(null);
    }
  };

  return (
    <div className="games-view games-library">
      <div className="games-library-head">
        <div className="games-library-heading">
          <div className="games-library-title">Game Library</div>
          <div className="games-library-sub">
            Pick a console, find a game, and it’s downloaded and ready to play. ROMs are fetched on demand —
            nothing ships with the application.
          </div>
        </div>
        <button className="games-rom-btn games-rom-btn-ghost games-library-byo" onClick={onAddCustom}>
          Add your own ROM
        </button>
      </div>

      <div className="games-consoles" role="tablist">
        {CONSOLES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === consoleId}
            className={`games-console${c.id === consoleId ? ' games-console-active' : ''}`}
            onClick={() => setConsoleId(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <input
        className="games-library-search"
        type="search"
        placeholder={`Search ${consoleLabel(consoleId)} games…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={status !== 'ready'}
      />

      {status === 'loading' && (
        <div className="games-library-state">
          <span className="games-spinner" aria-hidden /> Loading the {consoleLabel(consoleId)} catalog…
          <button className="games-rom-btn games-rom-btn-ghost games-library-retry" onClick={() => void api.requestCatalog(consoleId)}>
            Re-request
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="games-library-state">
          Couldn’t load the {consoleLabel(consoleId)} catalog{catalog?.error ? `: ${catalog.error}` : ''}.
          <button className="games-rom-btn games-rom-btn-ghost games-library-retry" onClick={() => { setStatus('loading'); void api.requestCatalog(consoleId); }}>
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="games-library-count">
            {filtered.total.toLocaleString()} game{filtered.total === 1 ? '' : 's'}
            {filtered.total > filtered.shown.length ? ` · showing ${filtered.shown.length} — refine your search` : ''}
          </div>
          <div className="games-catalog">
            {filtered.shown.map((g) => (
              <CatalogRow
                key={g.file}
                title={g.title}
                installedId={installed.get(g.file)}
                busy={busyFile === g.file}
                navigate={navigate}
                install={() => install(g.file, g.title)}
              />
            ))}
            {filtered.total === 0 && <div className="games-library-state">No games match “{query}”.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// Installed rows open the saved game's tab (preview on single-click); the
// rest are install actions — the download starts on the first click.
function CatalogRow({
  title, installedId, busy, navigate, install,
}: {
  title: string;
  installedId: string | undefined;
  busy: boolean;
  navigate: (path: string, opts?: { preview?: boolean }) => void;
  install: () => Promise<void>;
}): ReactElement {
  const { onClick, onDoubleClick } = usePreviewClick(
    () => navigate(`/game/${installedId}`, { preview: true }),
    () => navigate(`/game/${installedId}`),
  );
  return (
    <button
      className={`games-catalog-row${installedId ? ' games-catalog-row-installed' : ''}`}
      onClick={installedId ? onClick : () => void install()}
      onDoubleClick={installedId ? onDoubleClick : undefined}
      disabled={busy}
      title={title}
    >
      <span className="games-catalog-title">{title}</span>
      <span className="games-catalog-action">
        {busy ? 'Adding…' : installedId ? 'Open ▸' : 'Play ▸'}
      </span>
    </button>
  );
}
