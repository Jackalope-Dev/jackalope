import { Button, ExternalLinkIcon, SettingActions, SettingBody, SettingGroup } from '@jackalope/ui';

import { useEffect, useRef, useState } from 'react';
import { ACCOUNT_BENEFITS, type AccountStatus } from '../../lib/account';
import { invokeNative } from '../../lib/native/transport';
import { nativeMessage, useAccountStore } from '../../stores/accountStore';
import { useReferralStore } from '../../stores/referralStore';
import { useSettingsSyncStore } from '../../stores/settingsSyncStore';
import { WaitlistAccount } from '../account/WaitlistAccount';
import { FeedbackPreferences } from './FeedbackPreferences';

export function JackalopeAccount({
  presentation = 'settings',
  onInvitations,
  onStatus,
}: {
  presentation?: 'settings' | 'welcome' | 'onboarding';
  onInvitations?: () => void;
  onStatus?: (status: AccountStatus) => void;
}) {
  const account = useAccountStore((state) => state.status);
  const readError = useAccountStore((state) => state.error);
  const referrals = useReferralStore((state) => state.referrals);
  const [actionError, setError] = useState('');
  const error = actionError || readError;
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const pollInterval = account?.waitlist ? 60000 : 5000;
  useEffect(() => {
    mounted.current = true;
    void useAccountStore.getState().load(true);
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!['pending', 'waiting', 'waiting-offline'].includes(account?.state ?? '')) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!pending.current) {
        try {
          const next = await invokeNative<AccountStatus>('app_account_poll');
          // Keep checking after a failure rather than stranding the user on a
          // stale message: an unlocked keychain or a freed device slot should
          // recover on its own, without them restarting the app.
          if (!canceled) {
            useAccountStore.getState().update(next);
            setError('');
          }
        } catch (cause) {
          // Report what actually failed. A generic message here hides the
          // recoverable cases, such as a locked keychain, behind advice that
          // does not apply.
          if (!canceled)
            setError(
              nativeMessage(cause) ||
                'Could not check the connection. Your local projects are still available.',
            );
        }
      }
      if (!canceled) timer = setTimeout(poll, pollInterval);
    };
    timer = setTimeout(poll, pollInterval);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [account?.state, pollInterval]);
  async function act(command: string, refresh = true) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    useAccountStore.getState().setError('');
    try {
      const next = await invokeNative<AccountStatus>(command);
      if (refresh) useAccountStore.getState().update(next);
    } catch (cause) {
      if (mounted.current)
        setError(nativeMessage(cause) || 'Could not complete the connection. Please retry.');
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
  const waiting =
    (account?.state === 'waiting' || account?.state === 'waiting-offline') && !!account.waitlist;
  const status = (
    <>
      {!account && !error && <p role="status">Reading account connection…</p>}
      {account?.state === 'unavailable' && (
        <p>Open the desktop app to connect your Jackalope account.</p>
      )}
      {connected && (
        <div className="space-y-2">
          <p className="break-all font-medium">{account.email}</p>
          <p role="status" className="settings-row-description">
            {account.state === 'connected'
              ? 'Signed in'
              : 'Could not reach Jackalope to check your account. Account features keep working for up to 72 hours offline. Local work is not affected.'}
          </p>
        </div>
      )}
      {waiting && account?.waitlist && (
        <WaitlistAccount
          email={account.email}
          progress={account.waitlist}
          offline={account.state === 'waiting-offline'}
        />
      )}
      {(account?.state === 'pending' || (account?.state === 'waiting' && !waiting)) && (
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
            {account.state === 'waiting'
              ? 'Sign in to check your access. This connection request expires in 10 minutes.'
              : 'Sign in or create a free account to connect this desktop. This connection request expires in 10 minutes.'}
          </p>
        </div>
      )}
      {account?.state === 'expired' && (
        <p role="status">Your connection request ended. Connect again to try once more.</p>
      )}
    </>
  );
  const actions = (
    <>
      {(account?.state === 'disconnected' || account?.state === 'expired') && (
        <Button
          disabled={busy}
          onClick={() => void act('app_account_connect')}
          loading={busy}
          loadingLabel="Connecting…"
        >
          {welcome ? 'Create free account or sign in' : 'Connect account'}
          {welcome && !busy && <ExternalLinkIcon size={20} aria-hidden="true" />}
        </Button>
      )}
      {(account?.state === 'pending' || (account?.state === 'waiting' && !waiting)) && (
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
      {waiting && (
        <>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act('app_account_status')}
            loading={busy}
            loadingLabel="Checking…"
          >
            Refresh status
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act('app_account_open_browser', false)}
          >
            Manage waitlist on website
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act('app_account_disconnect')}
          >
            Disconnect this desktop
          </Button>
        </>
      )}
      {connected && (
        <>
          {onInvitations && referrals && (
            <Button onClick={onInvitations}>
              {referrals.openSignup ? 'Invite friends' : 'View Instant Access Passes'}
            </Button>
          )}
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
    </>
  );
  const failure = error && (
    <p role="alert" className="settings-row-description">
      {error}
    </p>
  );
  if (welcome)
    return (
      <div className="access-account">
        {status}
        <div className="access-account-actions">{actions}</div>
        {failure}
      </div>
    );
  return (
    <>
      <SettingGroup
        title="Your account"
        description={
          account?.state === 'disconnected' || account?.state === 'expired'
            ? `Optional. ${ACCOUNT_BENEFITS}`
            : undefined
        }
      >
        <SettingBody>{status}</SettingBody>
        <SettingActions>{actions}</SettingActions>
        {failure && <SettingBody>{failure}</SettingBody>}
      </SettingGroup>
      {connected && <FeedbackPreferences />}
    </>
  );
}
