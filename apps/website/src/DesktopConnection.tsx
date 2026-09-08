import { useCallback, useEffect, useState } from 'react';
import { accessMessage, accessRequest } from './access-api';

const storageKey = 'jackalope-desktop-approval';
export function DesktopConnection({
  email,
  refreshMembership,
}: {
  email: string | null;
  refreshMembership: () => void;
}) {
  const signedIn = !!email;
  const [verification, setVerification] = useState('');
  const [preview, setPreview] = useState<{ userCode: string; expiresAt: number } | null>(null);
  const [matches, setMatches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [expiresAt, setExpiresAt] = useState(Date.now() + 10 * 60000);
  useEffect(() => {
    function readRequest() {
      const url = new URL(window.location.href);
      const fragment = new URLSearchParams(url.hash.slice(1));
      const token = fragment.get('desktop');
      if (token) {
        setDone('');
        setError('');
        setMatches(false);
        setPreview(null);
        fragment.delete('desktop');
        history.replaceState(
          null,
          '',
          url.pathname + url.search + (fragment.size ? `#${fragment}` : ''),
        );
        setExpiresAt(Date.now() + 10 * 60000);
        if (!/^[a-f0-9]{64}$/.test(token)) {
          setVerification('');
          setDone('This connection request is invalid. Return to Jackalope to start again.');
          try {
            sessionStorage.removeItem(storageKey);
          } catch {}
          return;
        }
      }
      try {
        if (token && /^[a-f0-9]{64}$/.test(token))
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({ token, expires: Date.now() + 10 * 60000 }),
          );
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (
          saved &&
          typeof saved.token === 'string' &&
          /^[a-f0-9]{64}$/.test(saved.token) &&
          saved.expires > Date.now()
        ) {
          setVerification(saved.token);
          setExpiresAt(Math.min(saved.expires, Date.now() + 10 * 60000));
        } else sessionStorage.removeItem(storageKey);
      } catch {
        if (token && /^[a-f0-9]{64}$/.test(token)) setVerification(token);
      }
    }
    readRequest();
    window.addEventListener('hashchange', readRequest);
    return () => window.removeEventListener('hashchange', readRequest);
  }, []);
  useEffect(() => {
    if (!verification) return;
    const timer = setTimeout(
      () => {
        setVerification('');
        setDone('This connection request expired. Return to Jackalope to start again.');
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Storage can be disabled. */
        }
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [verification, expiresAt]);
  useEffect(() => {
    if (!verification || signedIn) return;
    window.addEventListener('focus', refreshMembership);
    const timer = setInterval(refreshMembership, 5000);
    return () => {
      window.removeEventListener('focus', refreshMembership);
      clearInterval(timer);
    };
  }, [verification, signedIn, refreshMembership]);
  const loadPreview = useCallback(
    (signal?: AbortSignal) => {
      if (!verification || !email) return;
      setMatches(false);
      setPreview(null);
      void accessRequest<{ userCode: string; expiresAt: number }>(
        'desktop/preview',
        { verification },
        signal,
      )
        .then((value) => {
          if (!signal?.aborted) {
            setPreview(value);
            setExpiresAt(value.expiresAt);
            setError('');
          }
        })
        .catch((cause) => {
          if (!signal?.aborted) setError(accessMessage(cause));
        });
    },
    [verification, email],
  );
  useEffect(() => {
    const controller = new AbortController();
    loadPreview(controller.signal);
    return () => controller.abort();
  }, [loadPreview]);
  async function decide(action: 'approve' | 'deny') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await accessRequest(`desktop/${action}`, { verification });
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage can be disabled. */
      }
      setVerification('');
      setDone(
        action === 'approve'
          ? 'Desktop approved. Return to Jackalope to finish connecting.'
          : 'Connection canceled. This desktop has not been connected.',
      );
    } catch (cause) {
      setError(accessMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <section className="access-card">
        <h2>Desktop connection</h2>
        <p role="status">{done}</p>
      </section>
    );
  if (!verification) return null;
  return (
    <section className="access-card access-entry" aria-label="Connect desktop">
      <h2>Connect your desktop</h2>
      {!signedIn ? (
        <p>
          Sign in below using your invited email. If the email opens another tab, return here to
          approve the connection.
        </p>
      ) : (
        <>
          <p>
            Connect as <strong>{email}</strong>
          </p>
          <p>
            Only continue if you started this request in Jackalope and the desktop shows the same
            code. Connecting shares your membership status with that desktop.
          </p>
          {preview && (
            <>
              <p className="desktop-connection-code">
                {preview.userCode.slice(0, 4)}–{preview.userCode.slice(4)}
              </p>
              <label className="desktop-code-confirm">
                <input
                  type="checkbox"
                  checked={matches}
                  disabled={busy}
                  onChange={(event) => setMatches(event.target.checked)}
                />
                This code matches my desktop
              </label>
              <div className="desktop-connection-actions">
                <button
                  className="button button-primary"
                  type="button"
                  disabled={busy || !matches}
                  onClick={() => void decide('approve')}
                >
                  Connect this desktop
                </button>
                <button
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('deny')}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          {!preview && !error && <p role="status">Checking connection request…</p>}
        </>
      )}
      {error && (
        <p className="access-alert" role="alert">
          {error}
          {!preview && signedIn && (
            <button
              className="text-link"
              type="button"
              onClick={() => {
                setError('');
                loadPreview();
              }}
            >
              Retry
            </button>
          )}
        </p>
      )}
    </section>
  );
}

interface Device {
  id: string;
  createdAt: number;
  expiresAt: number;
}
export function ConnectedDesktops() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setDevices(await accessRequest<Device[]>('devices'));
    } catch (cause) {
      setError(accessMessage(cause));
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load]);
  async function revoke(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await accessRequest('desktop/revoke', { id });
      setConfirm('');
      await load();
    } catch (cause) {
      setError(accessMessage(cause));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="access-card">
      <h2>Connected desktops</h2>
      <p>
        Connect from Settings → Jackalope account in the app. Disconnecting removes account access
        on that desktop; its local projects and agent accounts remain available.
      </p>
      {devices?.length === 0 && <p>No desktops connected.</p>}
      {devices === null && !error && <p role="status">Reading connected desktops…</p>}
      {devices?.map((device) => (
        <div key={device.id} className="desktop-device-row">
          <div>
            <strong>Connected desktop</strong>
            <p>Connected {new Date(device.createdAt).toLocaleString()}</p>
          </div>
          <div className="desktop-connection-actions">
            {confirm === device.id ? (
              <>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={!!busy}
                  onClick={() => void revoke(device.id)}
                >
                  {busy ? 'Disconnecting…' : 'Confirm disconnect'}
                </button>
                <button
                  className="text-link"
                  type="button"
                  disabled={!!busy}
                  onClick={() => setConfirm('')}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="text-link"
                type="button"
                disabled={!!busy}
                onClick={() => setConfirm(device.id)}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      ))}
      {error && (
        <p className="access-alert" role="alert">
          {error}{' '}
          <button className="text-link" type="button" disabled={!!busy} onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
    </section>
  );
}
