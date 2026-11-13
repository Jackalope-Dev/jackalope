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
const root = windowKind();
// Paired phones show each shared project's icon; only the main window owns the project list.
if (root.kind === 'main') startProjectIconSync();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <DesktopExperience />
      {root.kind === 'workPane' ? (
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
