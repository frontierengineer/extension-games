import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useGames, useGamesRaw } from '../useGamesStore';
import { consoleSpec, consoleLabel } from '../constants';
import { EmulatorView } from './EmulatorView';
import type { SavedGame } from '../data';

export function GameView({ gameId, navigate }: { gameId: string; navigate: (path: string) => void }): ReactElement {
  const list = useGames((a) => a.list);
  const loaded = useGames((a) => a.loaded);
  const fetchList = useGames((a) => a.fetchList);

  useEffect(() => { if (!loaded) void fetchList(); }, [loaded, fetchList]);

  const game = list.find((g) => g.id === gameId);

  if (!loaded && !game) {
    return <div className="games-view games-view-message">Loading…</div>;
  }
  if (!game) {
    return (
      <div className="games-view games-view-message">
        <div className="games-view-title">Game not found</div>
        <div className="games-view-body">This saved game no longer exists.</div>
      </div>
    );
  }
  if (game.hasRom) {
    return <EmulatorView key={game.id} game={game} />;
  }
  // No ROM yet. A library game is downloading (or failed); a BYO game waits for
  // an upload.
  if (game.source) {
    return <Downloading game={game} navigate={navigate} />;
  }
  return <RomPicker game={game} navigate={navigate} />;
}

function Downloading({ game, navigate }: { game: SavedGame; navigate: (path: string) => void }): ReactElement {
  const api = useGamesRaw();
  const failed = game.fetch?.state === 'error';
  return (
    <div className="games-view games-view-message">
      <div className="games-view-title">{game.name}</div>
      {failed ? (
        <>
          <div className="games-view-body">Download failed: {game.fetch?.error || 'unknown error'}</div>
          <div className="games-rom-actions">
            <button className="games-rom-btn" onClick={() => void api.retryInstall(game.id)}>Try again</button>
            <button
              className="games-rom-btn games-rom-btn-ghost"
              onClick={() => { void api.deleteGame(game.id); navigate('/games/library'); }}
            >Remove</button>
          </div>
        </>
      ) : (
        <>
          <div className="games-spinner" aria-hidden />
          <div className="games-view-body">Downloading {consoleLabel(game.console)} ROM…</div>
        </>
      )}
    </div>
  );
}

function RomPicker({ game, navigate }: { game: SavedGame; navigate: (path: string) => void }): ReactElement {
  const api = useGamesRaw();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = (consoleSpec(game.console)?.romExtensions || []).join(',');

  const ingest = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.length === 0) throw new Error('That file is empty.');
      await api.putRom(game.id, buf);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read that file.');
    } finally {
      setBusy(false);
    }
  }, [api, game.id]);

  return (
    <div
      className={`games-view games-rom-picker${over ? ' games-rom-picker-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void ingest(e.dataTransfer.files?.[0]); }}
    >
      <div className="games-view-title">{game.name}</div>
      <div className="games-view-body">
        Drop a {consoleLabel(game.console)} ROM here, or pick one. It’s stored with this game.
      </div>
      <div className="games-rom-actions">
        <button className="games-rom-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Loading…' : 'Choose ROM file'}
        </button>
        <button className="games-rom-btn games-rom-btn-ghost" disabled={busy} onClick={() => navigate('/games/library')}>
          Browse the library
        </button>
      </div>
      {error && <div className="games-rom-error">{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept={accept || undefined}
        style={{ display: 'none' }}
        onChange={(e) => { void ingest(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}
