import { Eye, MousePointer2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type ComputerStatus,
  computerViewer,
  embeddableViewer,
  holdComputerViewer,
} from '../../lib/computers';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import './computers.css';

/** An open embedded viewer renews its hold well inside the 90 second lease. */
const LEASE_RENEW_MS = 30_000;

/**
 * Watch (view only) or take over a computer's screen, starting it first when
 * stopped. Local sandboxes open inside Jackalope and stay running while the
 * viewer is open; a cloud machine's viewer opens in the browser.
 */
export function ComputerViewer({ computer }: { computer: ComputerStatus }) {
  const [view, setView] = useState<{ url: string; interactive: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lease] = useState(() => crypto.randomUUID());
  const viewing = view !== null;

  useEffect(() => {
    if (!viewing) return;
    const timer = window.setInterval(
      () => void holdComputerViewer(computer.id, lease, true).catch(() => undefined),
      LEASE_RENEW_MS,
    );
    return () => {
      window.clearInterval(timer);
      void holdComputerViewer(computer.id, lease, false).catch(() => undefined);
    };
  }, [viewing, computer.id, lease]);

  const open = async (interactive: boolean) => {
    setBusy(true);
    setError('');
    try {
      const url = await computerViewer(computer.id, interactive, lease);
      if (!view && (!url || !embeddableViewer(url))) {
        void holdComputerViewer(computer.id, lease, false).catch(() => undefined);
      }
      if (!url) setError('No viewer is available for this computer right now.');
      else if (embeddableViewer(url)) setView({ url, interactive });
      else await openExternalUrl(url);
    } catch (cause) {
      if (!view) void holdComputerViewer(computer.id, lease, false).catch(() => undefined);
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const startable =
    computer.state === 'stopped' &&
    (computer.provider !== 'local-docker' || computer.settings.network);
  if (!computer.viewer && !startable && !view) return null;
  const loadingLabel = computer.state === 'running' ? 'Opening…' : 'Starting…';
  return (
    <div className="computer-viewer">
      <div className="computer-viewer-actions">
        {view ? (
          <>
            {!view.interactive && (
              <Button variant="outline" disabled={busy} onClick={() => void open(true)}>
                <MousePointer2 size={16} aria-hidden="true" />
                Take over
              </Button>
            )}
            <Button variant="outline" onClick={() => setView(null)}>
              <X size={16} aria-hidden="true" />
              Close viewer
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              loading={busy}
              loadingLabel={loadingLabel}
              disabled={busy}
              onClick={() => void open(false)}
            >
              <Eye size={16} aria-hidden="true" />
              Watch
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void open(true)}>
              <MousePointer2 size={16} aria-hidden="true" />
              Take over
            </Button>
          </>
        )}
      </div>
      {view?.interactive && (
        <p className="task-muted">
          Your mouse and keyboard now reach {computer.name}. The agent may act at the same time.
        </p>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {view && (
        <iframe
          key={view.url}
          className="computer-viewer-frame"
          src={view.url}
          title={`${computer.name} screen${view.interactive ? ', controllable' : ''}`}
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}
