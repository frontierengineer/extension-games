import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionSidebar, Split } from '@frontierengineer/ui';
import type { UiV1, UiProvider, ExtensionHost } from '../../types';
import { GamesSidebar } from './components/GamesSidebar';
import { GameView } from './components/GameView';
import { GamesLibrary } from './components/GamesLibrary';
import { initGames, useGames, useGamesRaw } from './useGamesStore';
import { CONSOLES, DEFAULT_CONSOLE } from './constants';
import './styles.css';

// ─────────────────────────────────────────────────────────────────────
// The Games app (shell-v2). ONE ui.extension.register that owns the whole content
// rect: a left rail listing the user's saved games (with a Browse action) and a
// main pane that shows either the LIBRARY (browse archive.org catalogs + add a
// game) or one running GAME. There is no host tab bar — the app holds the
// current selection in its own state and swaps the main pane. The sidebar,
// library and game components are re-housed verbatim; only their wiring (route
// navigation → app selection) changed.
// ─────────────────────────────────────────────────────────────────────

// What the main pane shows: the catalog browser, or one saved game by id.
type Selection = { kind: 'library' } | { kind: 'game'; id: string };

function GamesApp({ ui, host }: { ui: UiV1; host: ExtensionHost }) {
  const list = useGames((a) => a.list);
  const loaded = useGames((a) => a.loaded);

  // The library is the default landing — there's always something to do (browse
  // and add a game) even with no saved games yet.
  const [selection, setSelection] = useState<Selection>({ kind: 'library' });

  // Both the sidebar and the library navigate('/game/<id>' | '/games/library');
  // keep those components verbatim and translate the route into app selection.
  const navigate = useCallback((path: string) => {
    if (path.startsWith('/game/')) {
      const id = path.slice('/game/'.length);
      if (id) setSelection({ kind: 'game', id });
    } else {
      setSelection({ kind: 'library' });
    }
  }, []);

  // If the open game is deleted from the list, fall back to the library instead
  // of rendering a dead game.
  useEffect(() => {
    if (selection.kind === 'game' && loaded && !list.some((g) => g.id === selection.id)) {
      setSelection({ kind: 'library' });
    }
  }, [selection, loaded, list]);

  // Refresh the saved-games list on COMMIT (the user switched here) — a game may
  // have been added/removed elsewhere while this app was hidden. A peek is a
  // glance and takes no such side effect.
  useEffect(() => host.lifecycle.onActivate(() => { void useGamesRaw().fetchList(); }), [host]);

  const sidebar = (
    <ExtensionSidebar
      header={<div className="games-sidebar-title">Games</div>}
      footer={
        <button
          className="btn-secondary btn-sm games-browse-btn"
          onClick={() => setSelection({ kind: 'library' })}
        >
          Browse library
        </button>
      }
    >
      <GamesSidebar navigate={navigate} confirm={(o) => ui.modals.confirm(o)} />
    </ExtensionSidebar>
  );

  const main = selection.kind === 'game' ? (
    <GameView key={selection.id} gameId={selection.id} navigate={navigate} />
  ) : (
    <GamesLibrary navigate={navigate} onAddCustom={() => { void showNewGameModal(ui, navigate); }} />
  );

  return (
    <div className="games-app">
      <Split
        first={sidebar}
        second={main}
        initialFirstSize={240}
        minFirstSize={180}
        minSecondSize={420}
        storageKey="games.split"
      />
    </div>
  );
}

export function register(uiProvider: UiProvider): void {
  const ui = uiProvider.version(1);
  initGames(ui.services.store);

  // "Add Game" is the create command — it opens the host modal and creates a BYO
  // game. It runs in the controller realm (no openExtension), so the new game shows in
  // the rail once the Games app is shown; the in-app library's Add takes the
  // richer path (a navigate callback) so the fresh game opens in the main pane.
  ui.commands.register({
    id: 'games.new',
    label: 'Add Game (your own ROM)',
    category: 'Games',
    group: 'create',
    run: () => { void showNewGameModal(ui); },
  });

  // ONE app per extension — the whole games experience lives inside this mount.
  let root: ReturnType<typeof createRoot> | null = null;
  ui.extension.register({
    id: 'games',
    title: 'Games',
    // A game controller: a rounded body with a d-pad and two buttons.
    icon: 'M5 6.5H3.5a2 2 0 0 0-2 2l-.4 3a1.6 1.6 0 0 0 3 .8L4.5 11h7l.4 1.3a1.6 1.6 0 0 0 3-.8l-.4-3a2 2 0 0 0-2-2zM3.5 8.5h2M4.5 7.5v2M10.5 8.5h.01M12 9.5h.01',
    color: '#ef4444',
    mount(host: ExtensionHost) {
      root = createRoot(host.container);
      root.render(<GamesApp ui={ui} host={host} />);
      return () => { root?.unmount(); root = null; };
    },
  });
}

async function showNewGameModal(ui: UiV1, onCreated?: (path: string) => void): Promise<void> {
  const result = await ui.modals.prompt({
    title: 'Add Your Own ROM',
    fields: [
      {
        key: 'console',
        label: 'Console',
        type: 'select',
        required: true,
        default: DEFAULT_CONSOLE,
        options: CONSOLES.map((c) => ({ value: c.id, label: c.label })),
      },
      { key: 'name', label: 'Game name', type: 'string', placeholder: 'Super Demo Bros', required: true },
    ],
    submitLabel: 'Add',
  });
  if (!result) return;
  try {
    const game = await useGamesRaw().createGame({ name: result.name, console: result.console });
    onCreated?.(`/game/${game.id}`);
  } catch (err) {
    console.error('[games] create failed:', err);
  }
}
