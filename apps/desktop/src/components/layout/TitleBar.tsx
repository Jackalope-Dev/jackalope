import { LifeBuoy, Minus, RotateCw, Settings2, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isMacPlatform } from '../../lib/platform-shortcuts';
import { displayShortcut, resolveShortcuts } from '../../lib/shortcuts';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { useSettingsStore } from '../../stores/settingsStore';
import { availableUpdateId, useUpdateStore } from '../../stores/updateStore';
import { ArcColorPicker } from '../theme/ArcColorPicker';
import { Tooltip } from '../ui/Tooltip';

const isMac = isMacPlatform();

/**
 * Custom window chrome. The bar itself is a `data-tauri-drag-region` so
 * dragging it moves the window; the button group stops mousedown
 * propagation so clicking a button doesn't also start a window drag. The
 * title always sits in the true center (grid, not flex, so it stays
 * centered even though the two side columns hold different content).
 *
 * On macOS this overlays a real titled window (`titleBarStyle: Overlay` +
 * `decorations: true` in tauri.macos.conf.json, with `hiddenTitle` so the
 * native title text doesn't double up with ours) so the OS draws the real
 * traffic lights, window corner rounding and shadow — the left column is
 * just empty space reserved for them. Other platforms use `decorations:
 * false` (tauri.conf.json) and get fully custom controls on the right.
 * A no-op outside Tauri (browser dev preview keeps its normal chrome).
 */
export function TitleBar({ onSettings }: { onSettings?: () => void }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const showThemePicker = useSettingsStore((state) => state.showThemePickerInToolbar);
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const beta = useUpdateStore((state) => state.release?.channel === 'beta');
  const updateReady = useUpdateStore(
    (state) =>
      state.downloadedVersion !== null &&
      state.downloadedVersion === availableUpdateId(state.release),
  );
  const updating = useUpdateStore((state) => state.installing);
  // Development builds and the beta channel are labeled; stable keeps the plain title.
  const edition = import.meta.env.DEV ? ' - dev' : beta ? ' - Beta' : '';

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
    <div data-tauri-drag-region className={`app-titlebar${isMac ? ' app-titlebar-mac' : ''}`}>
      {/* Empty on every platform: on macOS this space sits under the native
          traffic lights (drawn by the OS via titleBarStyle: Overlay); on
          other platforms it just balances the right column so the title
          below stays centered. */}
      <div className="app-titlebar-left" data-tauri-drag-region />
      <div className="app-titlebar-label" data-tauri-drag-region>
        <img src="/mascot.svg" alt="" aria-hidden="true" className="size-3.5" />
        <span>Jackalope{edition}</span>
      </div>
      <div className="app-titlebar-controls">
        {updateReady && (
          <Tooltip content="The update is downloaded. Jackalope reopens in a few seconds.">
            <button
              type="button"
              className="app-titlebar-update"
              disabled={updating}
              aria-busy={updating}
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={() => void useUpdateStore.getState().install()}
            >
              <RotateCw size={13} aria-hidden="true" />
              {updating ? 'Restarting…' : 'Restart to update'}
            </button>
          </Tooltip>
        )}
        {onSettings && showThemePicker && <ArcColorPicker variant="titlebar" />}
        {onSettings && (
          <Tooltip content={`Settings (${displayShortcut(resolveShortcuts(shortcuts).settings)})`}>
            <button
              type="button"
              className="app-titlebar-button"
              aria-label="Settings and preferences"
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={onSettings}
            >
              <Settings2 size={16} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Help Center">
          <button
            type="button"
            className={`app-titlebar-button app-titlebar-help ${isMac ? 'app-titlebar-help-last' : ''}`}
            aria-label="Help and knowledgebase"
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={() => void openExternalUrl('https://jackalope.dev/knowledge/')}
          >
            <LifeBuoy size={16} />
          </button>
        </Tooltip>
        {!isMac && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
