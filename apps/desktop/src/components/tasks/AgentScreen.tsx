import { Badge } from '@jackalope/ui';
import { AppWindow, ExternalLink, Globe, Lock, Monitor } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  desktopLabel,
  openableUrl,
  readAgentScreen,
  revokeAgentAccess,
  type AgentScreen as Screen,
} from '../../lib/agent-screen';
import { isActive, type TaskRun } from '../../lib/task-runtime';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { ScreenshotPreview } from './ScreenshotPreview';
import './agent-screen.css';

const POLL_MS = 2000;

/**
 * Shows what the agent can see: its task browser's current viewport and any
 * desktop window the user granted. Polling only reads existing sessions; it
 * never opens a browser or asks for desktop access.
 */
export function AgentScreen({ run, visible = true }: { run: TaskRun; visible?: boolean }) {
  const active = isActive(run);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [frame, setFrame] = useState<{ src: string; url: string | null } | null>(null);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<'' | 'browser' | 'desktop'>('');
  const [imageAttempt, setImageAttempt] = useState(0);
  const runId = run.id;
  const reading = useRef(false);

  useEffect(() => {
    if (!visible || !isTauriEnvironment()) return;
    let alive = true;
    const read = async () => {
      if (reading.current || document.visibilityState === 'hidden') return;
      reading.current = true;
      try {
        const next = await readAgentScreen(runId, active);
        if (!alive) return;
        setScreen(next);
        setError('');
        if (next.browser.frame)
          setFrame({ src: `data:image/png;base64,${next.browser.frame}`, url: next.browser.url });
        else if (next.browser.status === 'stopped' || next.browser.status === 'unavailable')
          setFrame(null);
      } catch (cause) {
        if (alive) setError(String(cause));
      } finally {
        reading.current = false;
      }
    };
    void read();
    // A finished attempt cannot change its browser or grant, so one read is enough.
    const timer = active ? window.setInterval(() => void read(), POLL_MS) : undefined;
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [runId, active, visible]);

  const revoke = async (target: 'browser' | 'desktop') => {
    setRevoking(target);
    setError('');
    try {
      await revokeAgentAccess(runId, target);
      const next = await readAgentScreen(runId, false);
      setScreen(next);
      if (target === 'browser') setFrame(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRevoking('');
    }
  };

  const browser = screen?.browser;
  const desktop = screen?.desktop ?? null;
  const desktopState = desktopLabel(desktop);
  const pageUrl = frame?.url ?? browser?.url ?? null;
  const openable = openableUrl(pageUrl);
  const captures = (run.screenshots ?? []).slice(-4).reverse();
  const browserLabel = !active
    ? 'Attempt ended'
    : browser?.status === 'live'
      ? 'Live'
      : browser?.status === 'busy'
        ? 'Agent is acting'
        : browser?.status === 'stopped'
          ? 'Stopped'
          : 'Not opened';

  return (
    <section className="agent-screen" aria-label="Agent’s screen">
      {!isTauriEnvironment() && (
        <InlineNotice>The agent’s screen is available in the desktop app.</InlineNotice>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      <div className="agent-screen-section">
        <div className="agent-screen-heading">
          <Globe size={16} aria-hidden="true" />
          <h3>Browser</h3>
          <Badge
            variant={browser?.status === 'live' && active ? 'accent' : 'default'}
            aria-live="polite"
          >
            {browserLabel}
          </Badge>
        </div>
        <figure className="agent-screen-frame" data-empty={!frame || undefined}>
          <div className="agent-screen-address">
            <Lock size={12} aria-hidden="true" />
            <span title={pageUrl ?? undefined}>{pageUrl || 'No page open'}</span>
          </div>
          {frame ? (
            <img src={frame.src} alt={`Agent browser showing ${pageUrl || 'a page'}`} />
          ) : (
            <p className="agent-screen-empty">
              {active
                ? 'The agent’s browser appears here when it opens a page. Each task gets a fresh, isolated browser without your sign-ins.'
                : 'This attempt has ended. Recorded captures stay below.'}
            </p>
          )}
        </figure>
        <div className="agent-screen-actions">
          <Button
            variant="outline"
            disabled={!openable}
            onClick={() => openable && void openExternalUrl(openable)}
          >
            <ExternalLink size={16} aria-hidden="true" />
            Open page in my browser
          </Button>
          {active && browser?.status !== 'unavailable' && browser?.status !== 'stopped' && (
            <Button
              variant="outline"
              loading={revoking === 'browser'}
              loadingLabel="Stopping…"
              disabled={!!revoking}
              onClick={() => void revoke('browser')}
            >
              Stop browser
            </Button>
          )}
        </div>
      </div>

      <div className="agent-screen-section">
        <div className="agent-screen-heading">
          <Monitor size={16} aria-hidden="true" />
          <h3>Desktop window</h3>
          <Badge variant={desktopState.tone}>{desktopState.label}</Badge>
        </div>
        {desktop?.window ? (
          <p className="agent-screen-window">
            <AppWindow size={16} aria-hidden="true" />
            <span>
              <strong>{desktop.window}</strong>
              {desktop.app && <small>{desktop.app}</small>}
            </span>
          </p>
        ) : (
          <p className="task-muted">
            {desktop?.status === 'choosing'
              ? 'The agent asked to control one window. Answer its question to choose a window or decline.'
              : 'The agent cannot see or control your desktop. It must ask, and you choose one window.'}
          </p>
        )}
        {desktop?.status === 'paused' && (
          <InlineNotice tone="warning">
            {desktop.reason || 'Your input paused control.'} Use Resume on the bar above the window
            to continue.
          </InlineNotice>
        )}
        {active && desktop && desktop.status !== 'canceled' && (
          <div className="agent-screen-actions">
            <Button
              variant="danger"
              loading={revoking === 'desktop'}
              loadingLabel="Revoking…"
              disabled={!!revoking}
              onClick={() => void revoke('desktop')}
            >
              Revoke desktop access
            </Button>
          </div>
        )}
      </div>

      {captures.length > 0 && (
        <div className="agent-screen-section">
          <div className="agent-screen-heading">
            <h3>Recorded captures</h3>
          </div>
          <div className="agent-screen-captures">
            {captures.map((capture) => (
              <figure key={`${capture.id}:${imageAttempt}`}>
                <ScreenshotPreview
                  runId={run.id}
                  screenshot={capture}
                  onRetry={() => setImageAttempt((value) => value + 1)}
                />
                <figcaption className="task-muted">
                  {capture.name} · {new Date(capture.timestamp).toLocaleTimeString()}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
