import { applyThemeTokens, DEFAULT_THEME } from '@jackalope/brand/theme';
import { Button, FormField, Input } from '@jackalope/ui';
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type RemoteAction, RemoteWorkspace } from './components/remote/RemoteWorkspace';
import { InlineNotice } from './components/ui/InlineNotice';
import './index.css';
import './components/ui/experience.css';
import './components/tasks/task-workspace.css';

const code = new URLSearchParams(location.hash.slice(1)).get('pair') ?? '';
document.body.classList.add('companion-body');
history.replaceState(null, '', location.pathname);
const tokenKey = 'jackalope-companion-device';
async function api<T>(route: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The host declined this request.');
  return data;
}
function Companion() {
  const [token, setToken] = useState(() => {
    if (code) return '';
    try {
      return localStorage.getItem(tokenKey) ?? '';
    } catch {
      return '';
    }
  });
  const [name, setName] = useState('My phone');
  const [linkCode, setLinkCode] = useState(code);
  const [pairing, setPairing] = useState(code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pairingAttempt = useRef(0);
  useEffect(() => {
    const receiveLink = () => {
      const next = new URLSearchParams(location.hash.slice(1)).get('pair');
      if (!next) return;
      history.replaceState(null, '', location.pathname);
      pairingAttempt.current++;
      setBusy(false);
      setToken('');
      setLinkCode(next);
      setPairing(next);
      setError('');
    };
    window.addEventListener('hashchange', receiveLink);
    return () => window.removeEventListener('hashchange', receiveLink);
  }, []);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const theme = () => applyThemeTokens({ ...DEFAULT_THEME, isDark: query.matches });
    theme();
    query.addEventListener('change', theme);
    return () => query.removeEventListener('change', theme);
  }, []);
  const request = useCallback(
    <T,>(action: RemoteAction) => api<T>('/api/request', action, token),
    [token],
  );
  return (
    <main className="companion-page">
      <header>
        <h1>Jackalope</h1>
        {token && (
          <Button
            variant="ghost"
            onClick={() => {
              try {
                localStorage.removeItem(tokenKey);
                setError('');
              } catch {
                setError(
                  'Disconnected for this visit. Clear this site’s browser data to forget the pairing.',
                );
              }
              setPairing('');
              setToken('');
            }}
          >
            Disconnect
          </Button>
        )}
      </header>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {token ? (
        <RemoteWorkspace key={token} request={request} storageKey="jackalope-companion" />
      ) : (
        <form
          className="remote-pairing"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            const attempt = ++pairingAttempt.current;
            try {
              const result = await api<{ token: string }>('/api/pair', {
                code: pairing.trim(),
                name: name.trim(),
              });
              if (attempt !== pairingAttempt.current) return;
              setToken(result.token);
              setPairing('');
              try {
                localStorage.setItem(tokenKey, result.token);
              } catch {
                setError('Connected for this visit. This browser could not save the pairing.');
              }
            } catch (cause) {
              if (attempt === pairingAttempt.current) setError(String(cause));
            } finally {
              if (attempt === pairingAttempt.current) setBusy(false);
            }
          }}
        >
          <h2>Connect to your host</h2>
          <p>Create a pairing link in Jackalope → Settings → Remote access.</p>
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
          {(!linkCode || error || !pairing) && (
            <FormField label="Pairing code">
              <Input
                value={pairing}
                disabled={busy}
                required
                type="password"
                autoComplete="off"
                onChange={(event) => setPairing(event.target.value)}
              />
            </FormField>
          )}
          <Button
            type="submit"
            loading={busy}
            loadingLabel="Connecting…"
            disabled={busy || !pairing.trim() || !name.trim()}
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
    <Companion />
  </StrictMode>,
);
