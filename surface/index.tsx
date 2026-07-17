import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionSidebar, Split } from '@frontierengineer/ui';
import type { SurfaceProvider, SurfaceViewContext, SurfaceContext } from '../../types';
import { GamesSidebar } from './components/GamesSidebar';
import { GameView } from './components/GameView';
import { GamesLibrary } from './components/GamesLibrary';
import { initGames, useGames, useGamesRaw } from './useGamesStore';
import { CONSOLES, DEFAULT_CONSOLE } from './constants';
import './styles.css';

// ─────────────────────────────────────────────────────────────────────
// The Games app (shell-v2). ONE surface.application.register that owns the whole content
// rect: a left rail listing the user's saved games (with a Browse action) and a
// main pane that shows either the LIBRARY (browse archive.org catalogs + add a
// game) or one running GAME. There is no host tab bar — the app holds the
// current selection in its own state and swaps the main pane. The sidebar,
// library and game components are re-housed verbatim; only their wiring (route
// navigation → app selection) changed.
// ─────────────────────────────────────────────────────────────────────

// What the main pane shows: the catalog browser, or one saved game by id.
type Selection = { kind: 'library' } | { kind: 'game'; id: string };

function GamesApp({ context }: { context: SurfaceViewContext }) {
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

  // Refresh the saved-games list on activation (the user switched here) — a game
  // may have been added/removed elsewhere while this app was hidden.
  useEffect(() => {
    const sub = context.lifecycle.onFocus(() => { void useGamesRaw().fetchList(); });
    return () => sub.unsubscribe();
  }, [context]);

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
      <GamesSidebar navigate={navigate} confirm={(o) => context.modals.confirm(o).then((r) => r === true)} />
    </ExtensionSidebar>
  );

  const main = selection.kind === 'game' ? (
    <GameView key={selection.id} gameId={selection.id} navigate={navigate} />
  ) : (
    <GamesLibrary navigate={navigate} onAddCustom={() => { void showNewGameModal(context, navigate); }} />
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

export function register(surfaceProvider: SurfaceProvider): void {
  const surface = surfaceProvider.version(1);

  // The DAEMON: the always-on headless component that hosts the extension's
  // background logic. It seeds the games store from its own context and declares
  // the "Add Game" action. It is a zero-argument (input-null) action — invoked
  // from the palette it runs directly, opening the host prompt modal and creating
  // a BYO game from the daemon (no visible surface required), so the new game
  // shows in the rail once the Games app is shown; the in-app library's Add takes
  // the richer path (a navigate callback) so the fresh game opens in the main pane.
  surface.daemon.register({
    mount(ctx) {
      initGames(ctx.store);
      ctx.actions.register({
        id: 'games.new',
        title: 'Add Game (your own ROM)',
        description:
          'Add a game from one of your own ROM files to the Games library. Opens a dialog ' +
          'that asks for the console and a name for the game, then saves it so it appears in ' +
          'the Games rail. Same as the "Browse library" / Add flow inside the Games app.',
        category: 'Games',
        defaultKey: null,
        group: 'create',
        // Input-null: the create flow gathers its own console + name through a
        // bespoke prompt modal, so there is no host-generated schema.
        input: null,
        output: null,
        run: () => { void showNewGameModal(ctx); },
      });
      return {};
    },
  });

  // ONE app per extension — the whole games experience lives inside this mount.
  let root: ReturnType<typeof createRoot> | null = null;
  surface.application.register({
    id: 'games',
    title: 'Games',
    // A game controller: a rounded body with a d-pad and two buttons.
    icon: 'M5 6.5H3.5a2 2 0 0 0-2 2l-.4 3a1.6 1.6 0 0 0 3 .8L4.5 11h7l.4 1.3a1.6 1.6 0 0 0 3-.8l-.4-3a2 2 0 0 0-2-2zM3.5 8.5h2M4.5 7.5v2M10.5 8.5h.01M12 9.5h.01',
    color: '#ef4444',
    requires: null,
    mount(context: SurfaceViewContext) {
      initGames(context.store);
      root = createRoot(context.container);
      root.render(<GamesApp context={context} />);
      return { dispose: () => { root?.unmount(); root = null; } };
    },
  });
}

async function showNewGameModal(context: SurfaceContext, onCreated?: (path: string) => void): Promise<void> {
  const result = await context.modals.prompt({
    title: 'Add Your Own ROM',
    description: null,
    fields: [
      {
        key: 'console',
        label: 'Console',
        type: 'select',
        placeholder: null,
        options: CONSOLES.map((c) => ({ value: c.id, label: c.label })),
        required: true,
        default: DEFAULT_CONSOLE,
        help: null,
      },
      { key: 'name', label: 'Game name', type: 'string', placeholder: 'Super Demo Bros', options: null, required: true, default: null, help: null },
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
