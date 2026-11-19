import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { DesktopExperience } from './components/layout/DesktopExperience';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';
import { suppressNativeContextMenu } from './lib/native-context-menu';
import { startProjectIconSync } from './lib/remote-project-icons';
import { windowKind } from './lib/window-kind';

suppressNativeContextMenu();

const LiveSessionWindow = React.lazy(() => import('./components/sessions/LiveSessionWindow'));
const WorkPaneWindow = React.lazy(() => import('./components/tasks/WorkPaneWindow'));
const GlobOverlay = React.lazy(() =>
  import('./components/sessions/GlobOverlay').then((m) => ({ default: m.GlobOverlay })),
);
const AttachBadge = React.lazy(() =>
  import('./components/sessions/AttachBadge').then((m) => ({ default: m.AttachBadge })),
);
const root = windowKind();
const overlay = root.kind === 'glob' || root.kind === 'badge';
// Overlay windows are transparent from their very first paint: the page background, the
// theme class and the body's background utility would otherwise flash as a solid box.
if (overlay) {
  for (const element of [document.documentElement, document.body]) {
    element.style.setProperty('background', 'transparent', 'important');
    element.classList.remove('bg-background');
  }
  document.documentElement.classList.add('overlay-page');
}
// Paired phones show each shared project's icon; only the main window owns the project list.
if (root.kind === 'main') startProjectIconSync();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {!overlay && <DesktopExperience />}
      {root.kind === 'glob' ? (
        <React.Suspense fallback={null}>
          <GlobOverlay />
        </React.Suspense>
      ) : root.kind === 'badge' ? (
        <React.Suspense fallback={null}>
          <AttachBadge />
        </React.Suspense>
      ) : root.kind === 'workPane' ? (
        <React.Suspense fallback={<p>Loading task…</p>}>
          <WorkPaneWindow id={root.id} pane={root.pane} />
        </React.Suspense>
      ) : root.kind === 'liveSession' ? (
        <React.Suspense fallback={<p>Loading session…</p>}>
          <LiveSessionWindow id={root.id} />
        </React.Suspense>
      ) : (
        <App />
      )}
    </AppErrorBoundary>
  </React.StrictMode>,
);
