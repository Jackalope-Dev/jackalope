import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { DesktopExperience } from './components/layout/DesktopExperience';
import { AppErrorBoundary } from './components/ui/AppErrorBoundary';

const LiveSessionWindow = React.lazy(() => import('./components/sessions/LiveSessionWindow'));
const liveSessionId = new URLSearchParams(window.location.search).get('liveSession');
const WorkPaneWindow = React.lazy(() => import('./components/tasks/WorkPaneWindow'));
const workPaneId = new URLSearchParams(window.location.search).get('workPane');
const CliTerminalWindow = React.lazy(() => import('./components/terminal/CliTerminalWindow'));
const cliTerminalId = new URLSearchParams(window.location.search).get('cliTerminal');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <DesktopExperience />
      {cliTerminalId ? (
        <React.Suspense fallback={<p>Loading terminal…</p>}>
          <CliTerminalWindow
            id={cliTerminalId}
            directory={new URLSearchParams(window.location.search).get('directory') ?? ''}
          />
        </React.Suspense>
      ) : workPaneId ? (
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
