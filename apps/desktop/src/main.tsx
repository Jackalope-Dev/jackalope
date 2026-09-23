import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { DesktopExperience } from './components/layout/DesktopExperience';

const LiveSessionWindow = React.lazy(() => import('./components/sessions/LiveSessionWindow'));
const liveSessionId = new URLSearchParams(window.location.search).get('liveSession');
const WorkPaneWindow = React.lazy(() => import('./components/tasks/WorkPaneWindow'));
const workPaneId = new URLSearchParams(window.location.search).get('workPane');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
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
  </React.StrictMode>,
);
