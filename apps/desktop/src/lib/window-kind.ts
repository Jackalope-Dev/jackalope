/**
 * Which root this webview renders. The native side opens secondary windows with
 * `?workPane=<run>&pane=<pane>` (work_windows.rs), `?liveSession=<id>`
 * (live_sessions/windows.rs) or `?glob=<provider>` for the agent being dragged onto a
 * window (desktop_control/attach.rs); the main window has none.
 */
export type WindowKind =
  | { kind: 'main' }
  | { kind: 'workPane'; id: string; pane: string }
  | { kind: 'liveSession'; id: string }
  | { kind: 'glob'; provider: string };

export function windowKind(search = globalThis.location?.search ?? ''): WindowKind {
  const parameters = new URLSearchParams(search);
  const workPane = parameters.get('workPane');
  if (workPane) return { kind: 'workPane', id: workPane, pane: parameters.get('pane') ?? 'result' };
  const liveSession = parameters.get('liveSession');
  if (liveSession) return { kind: 'liveSession', id: liveSession };
  const glob = parameters.get('glob');
  if (glob !== null) return { kind: 'glob', provider: glob };
  return { kind: 'main' };
}

export const isMainWindow = () => windowKind().kind === 'main';
