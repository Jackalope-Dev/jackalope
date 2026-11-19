/**
 * Which root this webview renders. The native side opens secondary windows with
 * `?workPane=<run>&pane=<pane>` (work_windows.rs), `?liveSession=<id>`
 * (live_sessions/windows.rs), `?glob=1` for the agent being dragged onto a window, `?globFrame=1` for the outline
 * around the window it would attach to
 * (desktop_control/attach/overlay.rs) or `?attachBadge=<label>` for an attached window's
 * badge (attach/badge.rs); the main window has none.
 */
export type WindowKind =
  | { kind: 'main' }
  | { kind: 'workPane'; id: string; pane: string }
  | { kind: 'liveSession'; id: string }
  | { kind: 'glob' }
  | { kind: 'frame' }
  | { kind: 'badge'; label: string };

export function windowKind(search = globalThis.location?.search ?? ''): WindowKind {
  const parameters = new URLSearchParams(search);
  const workPane = parameters.get('workPane');
  if (workPane) return { kind: 'workPane', id: workPane, pane: parameters.get('pane') ?? 'result' };
  const liveSession = parameters.get('liveSession');
  if (liveSession) return { kind: 'liveSession', id: liveSession };
  if (parameters.get('glob') !== null) return { kind: 'glob' };
  if (parameters.get('globFrame') !== null) return { kind: 'frame' };
  const badge = parameters.get('attachBadge');
  if (badge) return { kind: 'badge', label: badge };
  return { kind: 'main' };
}

export const isMainWindow = () => windowKind().kind === 'main';
