import { Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';

/**
 * Custom window chrome, replacing the OS titlebar (see `decorations: false`
 * in tauri.conf.json). The bar itself is a `data-tauri-drag-region` so
 * dragging it moves the window; the button group stops mousedown
 * propagation so clicking a button doesn't also start a window drag.
 * A no-op outside Tauri (browser dev preview keeps its normal chrome).
 */
export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      setIsMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
      });
    })();
    return () => unlisten?.();
  }, []);

  if (!isTauriEnvironment()) return null;

  type Win = ReturnType<typeof import('@tauri-apps/api/window')['getCurrentWindow']>;

  const withWindow = async (fn: (win: Win) => Promise<void>) => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await fn(getCurrentWindow());
  };

  return (
    <div data-tauri-drag-region className="app-titlebar">
      <div className="app-titlebar-label" data-tauri-drag-region>
        <img src="/mascot.svg" alt="" aria-hidden="true" className="size-3.5" />
        <span>Jackalope</span>
      </div>
      <div className="app-titlebar-controls">
        <button
          type="button"
          className="app-titlebar-button"
          aria-label="Minimize window"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => withWindow((win) => win.minimize())}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="app-titlebar-button"
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => withWindow((win) => win.toggleMaximize())}
        >
          <Square size={11} />
        </button>
        <button
          type="button"
          className="app-titlebar-button app-titlebar-button-close"
          aria-label="Close window"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => withWindow((win) => win.close())}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
