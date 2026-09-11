import { EchoMark } from '@jackalope/brand/echo';
import { Button, Checkbox } from '@jackalope/ui';
import { Check, Monitor } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { accessMessage, accessRequest } from './access-api';

const storageKey = 'jackalope-desktop-approval';
export function DesktopConnection({
  email,
  refreshMembership,
  waiting = false,
}: {
  email: string | null;
  refreshMembership: () => void;
  waiting?: boolean;
}) {
  const signedIn = !!email;
  const [verification, setVerification] = useState('');
  const [preview, setPreview] = useState<{ userCode: string; expiresAt: number } | null>(null);
  const [matches, setMatches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [approved, setApproved] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [expiresAt, setExpiresAt] = useState(Date.now() + 10 * 60000);
  useEffect(() => {
    if (done) resultHeading.current?.focus();
  }, [done]);
  useEffect(() => {
    function readRequest() {
      const url = new URL(window.location.href);
      const fragment = new URLSearchParams(url.hash.slice(1));
      const token = fragment.get('desktop');
      if (token) {
        setDone('');
        setApproved(false);
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
        `${waiting ? 'waitlist/' : ''}desktop/preview`,
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
    [verification, email, waiting],
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
      await accessRequest(`${waiting ? 'waitlist/' : ''}desktop/${action}`, { verification });
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage can be disabled. */
      }
      setVerification('');
      setApproved(action === 'approve' && !waiting);
      if (action === 'approve') window.dispatchEvent(new Event('jackalope-desktops-changed'));
      setDone(
        action === 'approve'
          ? waiting
            ? 'Your verified waitlist status was shared with this desktop. Early access still needs approval.'
            : 'Desktop approved. Return to Jackalope to finish connecting.'
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
      <section className="access-card desktop-connection-result" aria-live="polite">
        {approved && (
          <div className="desktop-connection-celebration" aria-hidden="true">
            <EchoMark animated={false} />
            <span>
              <Check size={26} strokeWidth={3} />
            </span>
          </div>
        )}
        <h2 ref={resultHeading} tabIndex={-1}>
          {approved ? 'Your desktop is approved.' : 'Desktop connection'}
        </h2>
        <p role="status">
          {approved ? 'Return to the Jackalope app to continue setting up your workspace.' : done}
        </p>
        {approved && (
          <p className="desktop-return-note">
            You can close this tab. Jackalope will continue automatically.
          </p>
        )}
      </section>
    );
  if (!verification) return null;
  return (
    <section className="access-card access-entry" aria-label="Connect desktop">
      <h2>Connect your desktop</h2>
      {!signedIn ? (
        <div>
          <p>
            Sign in below using your invited email. If the email opens another tab, return here to
            approve the connection.
          </p>
          <p>
            Still on the waitlist?{' '}
            <a className="text-link" href="/waitlist/">
              Verify your waitlist email
            </a>{' '}
            to share your acceptance status with the app.
          </p>
        </div>
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
                <Checkbox
                  checked={matches}
                  disabled={busy}
                  onChange={(event) => setMatches(event.target.checked)}
                />
                This code matches my desktop
              </label>
              <div className="desktop-connection-actions">
                <Button
                  variant="primary"
                  className="button button-primary"
                  type="button"
                  disabled={busy || !matches}
                  onClick={() => void decide('approve')}
                >
                  Connect this desktop
                </Button>
                <Button
                  variant="ghost"
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() => void decide('deny')}
                >
                  Cancel
                </Button>
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
            <Button
              variant="ghost"
              className="text-link"
              type="button"
              onClick={() => {
                setError('');
                loadPreview();
              }}
            >
              Retry
            </Button>
          )}
        </p>
      )}
    </section>
  );
}

interface Device {
  id: string;
  name?: string | null;
  createdAt: number;
  expiresAt: number;
  appVersion?: string | null;
  platform?: 'windows' | 'macos' | 'linux' | null;
  buildKind?: 'development' | 'release' | null;
  profileKind?: 'default' | 'isolated' | null;
  lastSeenAt?: number | null;
  settingsCheckedAt?: number | null;
  settingsSync?: number;
}
export function ConnectedDesktops() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState('');
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await accessRequest<Device[]>('devices', undefined, controller.signal);
      if (!controller.signal.aborted) {
        setDevices(next);
        setError('');
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(accessMessage(cause));
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible' && !request.current) void load();
    };
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    window.addEventListener('jackalope-desktops-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      request.current?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('jackalope-desktops-changed', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
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
    <section className="access-card connected-desktops">
      <h2>Connected desktops</h2>
      <p className="connected-desktops-description">
        Each app profile has its own connection. Development and test profiles can appear with the
        same computer name. Settings sync carries appearance and notification preferences; projects
        and task history stay in the local profile.
      </p>
      {devices?.length === 0 && <p>No desktops connected.</p>}
      {devices === null && !error && <p role="status">Reading connected desktops…</p>}
      {devices?.map((device) => (
        <div key={device.id} className="desktop-device-row">
          <div>
            <strong className="desktop-device-name">
              <Monitor size={18} />
              {device.name || `Desktop ${device.id.slice(0, 8)}`}
            </strong>
            <p>Connected {new Date(device.createdAt).toLocaleString()}</p>
            <dl className="desktop-device-details">
              <div>
                <dt>App</dt>
                <dd>
                  {device.appVersion ? `Jackalope ${device.appVersion}` : 'Version not reported'}
                  {device.buildKind === 'development'
                    ? ' · Development build'
                    : device.buildKind === 'release'
                      ? ' · Release build'
                      : ''}
                </dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>
                  {device.platform
                    ? { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[device.platform]
                    : 'Not reported'}
                </dd>
              </div>
              <div>
                <dt>Profile</dt>
                <dd>
                  {device.profileKind === 'isolated'
                    ? 'Isolated test profile'
                    : device.profileKind === 'default'
                      ? 'Default profile'
                      : 'Not reported'}{' '}
                  · Connection {device.id.slice(0, 8)}
                </dd>
              </div>
              <div>
                <dt>Last account check</dt>
                <dd>
                  {device.lastSeenAt
                    ? new Date(device.lastSeenAt).toLocaleString()
                    : 'Not recorded yet'}
                </dd>
              </div>
              <div>
                <dt>Settings sync</dt>
                <dd>
                  {device.settingsSync === 1
                    ? 'Enabled'
                    : device.settingsSync === 0
                      ? 'Off'
                      : 'Not reported'}
                  {device.settingsCheckedAt
                    ? ` · Last checked ${new Date(device.settingsCheckedAt).toLocaleString()}`
                    : ' · No check recorded yet'}
                </dd>
              </div>
              <div>
                <dt>Connection expires</dt>
                <dd>{new Date(device.expiresAt).toLocaleString()}</dd>
              </div>
            </dl>
          </div>
          <div className="desktop-device-actions">
            <div className="desktop-connection-actions">
              <Button
                variant="ghost"
                className={`button button-compact ${confirm === device.id ? 'button-primary' : 'button-quiet desktop-disconnect'}`}
                type="button"
                disabled={!!busy}
                aria-describedby={confirm === device.id ? `disconnect-${device.id}` : undefined}
                onClick={() =>
                  confirm === device.id ? void revoke(device.id) : setConfirm(device.id)
                }
              >
                {busy === device.id
                  ? 'Disconnecting…'
                  : confirm === device.id
                    ? 'Confirm disconnect'
                    : 'Disconnect'}
              </Button>
              {confirm === device.id && (
                <Button
                  variant="ghost"
                  className="button button-compact button-quiet"
                  type="button"
                  disabled={!!busy}
                  onClick={(event) => {
                    setConfirm('');
                    event.currentTarget.parentElement?.querySelector('button')?.focus();
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
            {confirm === device.id && (
              <p id={`disconnect-${device.id}`}>
                Disconnect this profile’s account access? Local projects and agent accounts are
                kept.
              </p>
            )}
          </div>
        </div>
      ))}
      {error && (
        <p className="access-alert" role="alert">
          {error}{' '}
          <Button
            variant="ghost"
            className="text-link"
            type="button"
            disabled={!!busy}
            onClick={() => void load()}
          >
            Retry
          </Button>
        </p>
      )}
    </section>
  );
}
