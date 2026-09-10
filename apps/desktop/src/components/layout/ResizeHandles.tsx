import { isTauriEnvironment } from '../../lib/tauri-bridge';

// Not exported from @tauri-apps/api/window, so mirrored here — must match
// the literal union `startResizeDragging` accepts.
type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

/**
 * With the OS titlebar/border removed (`decorations: false` in
 * tauri.conf.json), Windows loses its native edge-drag resize affordance.
 * These are thin, invisible hit regions around the window edges/corners that
 * hand off to the real OS resize via `startResizeDragging` — a no-op outside
 * Tauri.
 */
const EDGES: { direction: ResizeDirection; className: string }[] = [
  { direction: 'North', className: 'resize-n' },
  { direction: 'South', className: 'resize-s' },
  { direction: 'East', className: 'resize-e' },
  { direction: 'West', className: 'resize-w' },
  { direction: 'NorthEast', className: 'resize-ne' },
  { direction: 'NorthWest', className: 'resize-nw' },
  { direction: 'SouthEast', className: 'resize-se' },
  { direction: 'SouthWest', className: 'resize-sw' },
];

export function ResizeHandles() {
  if (!isTauriEnvironment()) return null;

  const startResize = async (direction: ResizeDirection) => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startResizeDragging(direction);
  };

  return (
    <>
      {EDGES.map(({ direction, className }) => (
        <div
          key={direction}
          className={`app-resize-handle ${className}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            void startResize(direction);
          }}
        />
      ))}
    </>
  );
}
