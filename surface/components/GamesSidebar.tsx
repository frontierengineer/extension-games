import { useEffect, type ReactElement } from 'react';
import { usePreviewClick } from '@frontierengineer/ui';
import { useGames } from '../useGamesStore';
import { consoleLabel } from '../constants';
import type { SavedGame } from '../data';
import type { ConfirmOptions } from '../../../types';

export function GamesSidebar({ navigate, confirm }: {
  navigate: (path: string, opts?: { preview?: boolean }) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}): ReactElement {
  const list = useGames((a) => a.list);
  const loaded = useGames((a) => a.loaded);
  const fetchList = useGames((a) => a.fetchList);
  const remove = useGames((a) => a.deleteGame);

  useEffect(() => { if (!loaded) void fetchList(); }, [loaded, fetchList]);

  const confirmDelete = async (g: SavedGame) => {
    const ok = await confirm({
      title: 'Delete game',
      message: `Delete "${g.name}"? Its ROM and save data are removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) void remove(g.id);
  };

  if (!loaded) {
    return <div className="games-sidebar-empty">Loading…</div>;
  }
  if (list.length === 0) {
    return <div className="games-sidebar-empty">No games yet. Open <strong>Browse library</strong> below to pick one, or add your own ROM.</div>;
  }
  return (
    <div className="games-sidebar-list">
      {list.map((g) => (
        <GameRow key={g.id} game={g} navigate={navigate} onDelete={confirmDelete} />
      ))}
    </div>
  );
}

function GameRow({
  game, navigate, onDelete,
}: {
  game: SavedGame;
  navigate: (path: string, opts?: { preview?: boolean }) => void;
  onDelete: (game: SavedGame) => Promise<void>;
}): ReactElement {
  const { onClick, onDoubleClick } = usePreviewClick(
    () => navigate(`/game/${game.id}`, { preview: true }),
    () => navigate(`/game/${game.id}`),
  );
  return (
    <div
      className="games-row"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={`${game.name} — ${consoleLabel(game.console)}`}
    >
      <span className="games-row-main">
        <span className="games-row-name">{game.name}</span>
        <span className="games-row-console">{consoleLabel(game.console)}</span>
      </span>
      {!game.hasRom && <RowFlag game={game} />}
      <button
        className="games-row-delete"
        title="Delete game"
        onClick={(e) => { e.stopPropagation(); void onDelete(game); }}
      >×</button>
    </div>
  );
}

function RowFlag({ game }: { game: SavedGame }): ReactElement {
  if (game.source && game.fetch?.state === 'error') {
    return <span className="games-row-flag games-row-flag-error" title={game.fetch.error || 'Download failed'}>failed</span>;
  }
  if (game.source) {
    return <span className="games-row-flag" title="Downloading ROM…">…</span>;
  }
  return <span className="games-row-flag" title="No ROM loaded yet">no ROM</span>;
}
