import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useGamesRaw } from '../useGamesStore';
import { consoleCore, consoleLabel } from '../constants';
import { emulatorSrcdoc, EMU_READY, EMU_ROM, EMU_ERROR, EMU_SAVE, EMU_STATE } from '../emulator';
import type { SavedGame } from '../data';

interface RomPayload {
  bytes: Uint8Array;
  save: Uint8Array | null;
  state: Uint8Array | null;
}

// Boots one game in a sandboxed (opaque-origin) EmulatorJS iframe. Reads the
// ROM plus any persisted save/state bytes from the store, waits for the frame
// to signal ready, posts them in, and persists save/state bytes the frame
// posts back (the sandboxed frame has no storage of its own).
export function EmulatorView({ game }: { game: SavedGame }): ReactElement {
  const api = useGamesRaw();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let payload: RomPayload | null = null;
    const core = consoleCore(game.console);

    const post = () => {
      const win = iframeRef.current?.contentWindow;
      if (!win || !payload) return;
      win.postMessage({ type: EMU_ROM, core, name: game.name, ...payload }, '*');
    };

    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data;
      if (!d) return;
      if (d.type === EMU_READY) post();
      else if (d.type === EMU_ERROR) setError(String(d.message || 'Emulator failed to start.'));
      else if (d.type === EMU_SAVE && d.bytes instanceof Uint8Array) void api.putSave(game.id, d.bytes);
      else if (d.type === EMU_STATE && d.bytes instanceof Uint8Array) void api.putState(game.id, d.bytes);
    };
    window.addEventListener('message', onMessage);

    void Promise.all([api.getRom(game.id), api.getSave(game.id), api.getState(game.id)]).then(([bytes, save, state]) => {
      if (!alive) return;
      if (!bytes) { setError('ROM bytes are missing.'); return; }
      // postMessage structured-clones the bytes, so the iframe gets its own copy.
      payload = { bytes, save, state };
      post(); // covers the case where the frame signalled ready before bytes loaded
    });

    return () => {
      alive = false;
      window.removeEventListener('message', onMessage);
      payload = null;
    };
  }, [api, game.id, game.console, game.name]);

  return (
    <div className="games-view games-player">
      <div className="games-player-bar">
        <span className="games-player-name">{game.name}</span>
        <span className="games-player-console">{consoleLabel(game.console)}</span>
        <span className="games-player-hint">Controls &amp; saves: use the in-emulator menu (bottom bar) — saves persist to your library</span>
      </div>
      <div className="games-player-stage">
        {error
          ? <div className="games-player-error">{error}</div>
          : <iframe
              ref={iframeRef}
              className="games-player-frame"
              title={game.name}
              sandbox="allow-scripts"
              srcDoc={emulatorSrcdoc()}
              allow="autoplay; gamepad; fullscreen"
              allowFullScreen
            />}
      </div>
    </div>
  );
}
