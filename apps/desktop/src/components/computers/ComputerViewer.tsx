import { Eye, MousePointer2, X } from 'lucide-react';
import { useState } from 'react';
import { type ComputerStatus, computerViewer, embeddableViewer } from '../../lib/computers';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import './computers.css';

/**
 * Watch (view only) or take over a running computer's screen. Local sandboxes
 * open inside Jackalope; a cloud machine's viewer opens in the browser.
 */
export function ComputerViewer({ computer }: { computer: ComputerStatus }) {
  const [view, setView] = useState<{ url: string; interactive: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async (interactive: boolean) => {
    setBusy(true);
    setError('');
    try {
      const url = await computerViewer(computer.id, interactive);
      if (!url) setError('No viewer is available for this computer right now.');
      else if (embeddableViewer(url)) setView({ url, interactive });
      else await openExternalUrl(url);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!computer.viewer && !view) return null;
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
            <Button variant="outline" disabled={busy} onClick={() => void open(false)}>
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
