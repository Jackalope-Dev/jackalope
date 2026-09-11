import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const LiveSessionWindow = React.lazy(() => import('./components/sessions/LiveSessionWindow'));
const liveSessionId = new URLSearchParams(window.location.search).get('liveSession');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {liveSessionId ? (
      <React.Suspense fallback={<p>Loading session…</p>}>
        <LiveSessionWindow id={liveSessionId} />
      </React.Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
