import { ExternalLinkIcon } from '@jackalope/ui';

import { useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useReferralStore } from '../../stores/referralStore';
import { useSettingsSyncStore } from '../../stores/settingsSyncStore';
import { Button } from '../ui/button';
import { FeedbackPreferences } from './FeedbackPreferences';

export interface AccountStatus {
  state:
    | 'unavailable'
    | 'disconnected'
    | 'pending'
    | 'waiting'
    | 'connected'
    | 'offline'
    | 'expired';
  email: string | null;
  userCode: string | null;
  expiresAt: number | null;
}
export function JackalopeAccount({
  presentation = 'settings',
  onInvitations,
  onStatus,
}: {
  presentation?: 'settings' | 'welcome' | 'onboarding';
  onInvitations?: () => void;
  onStatus?: (status: AccountStatus) => void;
}) {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (!isTauriEnvironment())
      setAccount({ state: 'unavailable', email: null, userCode: null, expiresAt: null });
    else
      void nativeTask<AccountStatus>('app_account_status')
        .then((value) => {
          if (mounted.current) setAccount(value);
        })
        .catch(() => {
          if (mounted.current) setError('Could not read your account connection. Please retry.');
        });
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!['pending', 'waiting'].includes(account?.state ?? '') || error) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!pending.current) {
        try {
          const next = await nativeTask<AccountStatus>('app_account_poll');
          if (!canceled) setAccount(next);
        } catch {
          if (!canceled)
            setError('Could not check the connection. Your local projects are still available.');
        }
      }
      if (!canceled) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [account?.state, error]);
  async function act(command: string, refresh = true) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await nativeTask<AccountStatus>(command);
      if (mounted.current && refresh) setAccount(next);
    } catch (cause) {
      if (mounted.current)
        setError(
          typeof cause === 'string' ? cause : 'Could not complete the connection. Please retry.',
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!account) return;
    onStatus?.(account);
    void useSettingsSyncStore.getState().refresh();
    useReferralStore.getState().clear();
    if (account.state === 'connected') void useReferralStore.getState().load(false);
  }, [account, onStatus]);
  const connected = account?.state === 'connected' || account?.state === 'offline';
  const welcome = presentation === 'welcome';
  return (
    <div className={welcome ? 'access-account' : 'space-y-6'}>
      {presentation === 'settings' && (
        <p className="settings-row-description">Beta access requires an approved account.</p>
      )}
      {!account && !error && <p role="status">Reading account connection…</p>}
      {account?.state === 'unavailable' && (
        <p>Open the desktop app to connect your Jackalope account.</p>
      )}
      {connected && (
        <div className="space-y-2">
          <p className="break-all font-medium">{account.email}</p>
          <p role="status" className="settings-row-description">
            {account.state === 'connected'
              ? 'Early access approved'
              : 'Access could not be checked. Previously verified beta access lasts up to 72 hours offline, or until the connection expires. Retry when online.'}
          </p>
        </div>
      )}
      {(account?.state === 'pending' || account?.state === 'waiting') && (
        <div className={welcome ? 'access-pairing' : 'space-y-4'}>
          <p role="status">
            {account.state === 'waiting'
              ? 'Your email is verified. Early access is still waiting for approval.'
              : 'Continue in your browser'}
          </p>
          <p className="settings-row-description">Only approve if this code matches:</p>
          <p className={welcome ? 'access-code' : 'font-mono text-xl tracking-widest'}>
            {account.userCode?.slice(0, 4)}–{account.userCode?.slice(4)}
          </p>
          <p className="settings-row-description">
            Sign in to check your access. This connection request expires in 10 minutes.
          </p>
        </div>
      )}
      {account?.state === 'expired' && (
        <p role="status">Your connection request ended. Connect again to try once more.</p>
      )}
      <div className={welcome ? 'access-account-actions' : 'flex flex-wrap gap-3'}>
        {(account?.state === 'disconnected' || account?.state === 'expired') && (
          <Button
            disabled={busy}
            onClick={() => void act('app_account_connect')}
            loading={busy}
            loadingLabel="Connecting…"
          >
            Connect account
            {welcome && !busy && <ExternalLinkIcon size={20} aria-hidden="true" />}
          </Button>
        )}
        {(account?.state === 'pending' || account?.state === 'waiting') && (
          <>
            <Button disabled={busy} onClick={() => void act('app_account_open_browser', false)}>
              Open browser
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act('app_account_disconnect')}
            >
              Cancel connection
            </Button>
          </>
        )}
        {connected && (
          <>
            {onInvitations && <Button onClick={onInvitations}>View Instant Access Passes</Button>}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act('app_account_open_browser', false)}
            >
              Manage account
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act('app_account_disconnect')}
              loading={busy}
              loadingLabel="Disconnecting…"
            >
              Disconnect this desktop
            </Button>
          </>
        )}
        {(error || account?.state === 'offline') && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(
                account?.state === 'pending' || account?.state === 'waiting'
                  ? 'app_account_poll'
                  : 'app_account_status',
              )
            }
          >
            Retry
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="settings-row-description">
          {error}
        </p>
      )}
      {connected && presentation === 'settings' && <FeedbackPreferences />}
    </div>
  );
}
