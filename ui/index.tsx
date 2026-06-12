import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UiV1, UiProvider, ViewContext } from '../../types';
import { GamesSidebar } from './components/GamesSidebar';
import { GameView } from './components/GameView';
import { GamesLibrary } from './components/GamesLibrary';
import { initGames, useGames, useGamesRaw } from './useGamesStore';
import { CONSOLES, DEFAULT_CONSOLE } from './constants';
import './styles.css';

const LIBRARY_PATH = '/games/library';

// Pushes a game tab's label (Game / <name>) on mount + whenever the game list
// changes. Replaces the old pull-based tabLabel(); renders nothing.
function GameTabLabel({ gameId, ctx }: { gameId: string; ctx: ViewContext }) {
  const name = useGames((api) => api.list.find((g) => g.id === gameId)?.name);
  useEffect(() => {
    ctx.setLabel({ primary: 'Game', secondary: name || gameId });
  }, [name, gameId, ctx]);
  return null;
}

export function register(uiProvider: UiProvider): void {
  const ui = uiProvider.version(1);
  initGames(ui.services.store);

  const viewRoots = new Map<HTMLElement, Root>();
  let sidebarRoot: Root | null = null;

  ui.commands.register({
    id: 'games.library',
    label: 'Game Library',
    category: 'Games',
    run: () => ui.navigate(LIBRARY_PATH),
  });

  ui.commands.register({
    id: 'games.new',
    label: 'Add Game (your own ROM)',
    category: 'Games',
    run: () => { void showNewGameModal(ui); },
  });

  ui.sidebar.register({
    id: 'games-list',
    title: 'Games',
    actions: [{ commandId: 'games.library', icon: '+', tooltip: 'Browse game library' }],
    mount(container) {
      sidebarRoot = createRoot(container);
      sidebarRoot.render(<GamesSidebar navigate={(p, o) => ui.navigate(p, o)} confirm={(o) => ui.modals.confirm(o)} />);
    },
    unmount() {
      sidebarRoot?.unmount();
      sidebarRoot = null;
    },
  });

  ui.views.register({
    id: 'library',
    // A singleton tab: the EXACT route maps /games/library → tabId 'games-library'
    // (the tabType), so there's no per-instance suffix and no label to push (the
    // library tab's caption is host-derived from the tabType).
    tabType: 'games-library',
    routes: [{ prefix: LIBRARY_PATH, exact: true }],
    mount(_tabId, container, ctx) {
      ctx.setLabel({ primary: 'Games', secondary: 'Library' });
      const root = createRoot(container);
      root.render(
        <GamesLibrary
          navigate={(p, o) => ui.navigate(p, o)}
          onAddCustom={() => { void showNewGameModal(ui); }}
        />,
      );
      viewRoots.set(container, root);
    },
    unmount(container) {
      viewRoots.get(container)?.unmount();
      viewRoots.delete(container);
    },
  });

  ui.views.register({
    id: 'game',
    tabType: 'game',
    routes: [{ prefix: '/game/' }],
    mount(tabId, container, ctx) {
      const root = createRoot(container);
      const gameId = tabId.slice('game:'.length);
      root.render(
        <>
          <GameTabLabel gameId={gameId} ctx={ctx} />
          <GameView gameId={gameId} navigate={(p) => ui.navigate(p)} />
        </>,
      );
      viewRoots.set(container, root);
    },
    unmount(container) {
      viewRoots.get(container)?.unmount();
      viewRoots.delete(container);
    },
  });

  ui.welcome.contribute({
    id: 'games-open',
    title: 'Play a Game',
    description: 'Browse games across NES, SNES, N64, Game Boy, GBA, Genesis and more — pick one and it downloads and runs in a tab.',
    action: { label: 'Open Game Library', run: () => ui.navigate(LIBRARY_PATH) },
  });
}

async function showNewGameModal(ui: UiV1): Promise<void> {
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
    ui.navigate(`/game/${game.id}`);
  } catch (err) {
    console.error('[games] create failed:', err);
  }
}
