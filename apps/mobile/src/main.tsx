import { applyThemeTokens, DEFAULT_THEME } from '@jackalope/brand/theme';
import { Button, FormField, Input } from '@jackalope/ui';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  type RemoteAction,
  RemoteWorkspace,
} from '../../desktop/src/components/remote/RemoteWorkspace';
import { InlineNotice } from '../../desktop/src/components/ui/InlineNotice';
import { forget, request as nativeRequest, pair, pairedHost } from './native';
import '../../desktop/src/index.css';
import '../../desktop/src/components/ui/experience.css';
import '../../desktop/src/components/tasks/task-workspace.css';
import './mobile.css';

document.body.classList.add('companion-body', 'mobile-body');

/**
 * The installable companion: the same screens as the host's web companion, reached
 * through native requests because the app is not served by the host it talks to.
 */
function MobileCompanion() {
  // undefined while the saved pairing is read; null when this phone is not paired.
  const [host, setHost] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState('My phone');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(0);
  useEffect(() => {
    void pairedHost()
      .then(setHost)
      .catch((cause) => {
        setHost(null);
        setError(String(cause));
      });
  }, []);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const theme = () => applyThemeTokens({ ...DEFAULT_THEME, isDark: query.matches });
    theme();
    query.addEventListener('change', theme);
    return () => query.removeEventListener('change', theme);
  }, []);
  const request = useCallback(<T,>(action: RemoteAction) => nativeRequest<T>(action), []);
  if (host === undefined) return null;
  return (
    <main className="companion-page">
      <header>
        <h1>Jackalope</h1>
        {host && (
          <Button
            variant="ghost"
            onClick={() =>
              void forget()
                .then(() => {
                  setHost(null);
                  setError('');
                })
                .catch((cause) => setError(String(cause)))
            }
          >
            Disconnect
          </Button>
        )}
      </header>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {host ? (
        <RemoteWorkspace key={host} request={request} storageKey="jackalope-mobile" />
      ) : (
        <form
          className="remote-pairing"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            const current = ++attempt.current;
            try {
              const paired = await pair(link.trim(), name.trim());
              if (current !== attempt.current) return;
              setLink('');
              setHost(paired);
            } catch (cause) {
              if (current === attempt.current) setError(String(cause));
            } finally {
              if (current === attempt.current) setBusy(false);
            }
          }}
        >
          <h2>Connect to your host</h2>
          <p>
            In Jackalope on your computer, open Settings → Remote access, create a pairing link and
            paste it here.
          </p>
          <FormField label="Device name">
            <Input
              value={name}
              disabled={busy}
              required
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </FormField>
          <FormField label="Pairing link">
            <Input
              value={link}
              disabled={busy}
              required
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://…/companion.html#pair=…"
              onChange={(event) => setLink(event.target.value)}
            />
          </FormField>
          <Button
            type="submit"
            loading={busy}
            loadingLabel="Connecting…"
            disabled={busy || !link.trim() || !name.trim()}
          >
            Connect
          </Button>
        </form>
      )}
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MobileCompanion />
  </StrictMode>,
);
