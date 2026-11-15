/**
 * Which root this webview renders. The native side opens secondary windows with
 * `?workPane=<run>&pane=<pane>` (work_windows.rs) or `?liveSession=<id>`
 * (live_sessions/windows.rs); the main window has neither.
 */
export type WindowKind =
  | { kind: 'main' }
  | { kind: 'workPane'; id: string; pane: string }
  | { kind: 'liveSession'; id: string };

export function windowKind(search = globalThis.location?.search ?? ''): WindowKind {
  const parameters = new URLSearchParams(search);
  const workPane = parameters.get('workPane');
  if (workPane) return { kind: 'workPane', id: workPane, pane: parameters.get('pane') ?? 'result' };
  const liveSession = parameters.get('liveSession');
  if (liveSession) return { kind: 'liveSession', id: liveSession };
  return { kind: 'main' };
}

export const isMainWindow = () => windowKind().kind === 'main';
