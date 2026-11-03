import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { DesktopExperience } from './components/layout/DesktopExperience';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';
import { suppressNativeContextMenu } from './lib/native-context-menu';

suppressNativeContextMenu();

const LiveSessionWindow = React.lazy(() => import('./components/sessions/LiveSessionWindow'));
const liveSessionId = new URLSearchParams(window.location.search).get('liveSession');
const WorkPaneWindow = React.lazy(() => import('./components/tasks/WorkPaneWindow'));
const workPaneId = new URLSearchParams(window.location.search).get('workPane');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <DesktopExperience />
      {workPaneId ? (
        <React.Suspense fallback={<p>Loading task…</p>}>
          <WorkPaneWindow
            id={workPaneId}
            pane={new URLSearchParams(window.location.search).get('pane') ?? 'result'}
          />
        </React.Suspense>
      ) : liveSessionId ? (
        <React.Suspense fallback={<p>Loading session…</p>}>
          <LiveSessionWindow id={liveSessionId} />
        </React.Suspense>
      ) : (
        <App />
      )}
    </AppErrorBoundary>
  </React.StrictMode>,
);
