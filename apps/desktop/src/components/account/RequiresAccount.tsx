import {
  Button,
  InlineNotice,
  LoadingState,
  SettingActions,
  SettingBody,
  SettingGroup,
} from '@jackalope/ui';
import { type ReactNode, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ACCOUNT_FEATURES, type AccountFeature, accountAccess } from '../../lib/account';
import { openSettings } from '../../lib/app-events';
import { useAccountStore } from '../../stores/accountStore';

/** Reads the account once for gated views; a recent status is reused. */
function useAccountAccess() {
  const { status, connecting, error } = useAccountStore(
    useShallow((state) => ({
      status: state.status,
      connecting: state.connecting,
      error: state.error,
    })),
  );
  useEffect(() => {
    void useAccountStore.getState().load();
  }, []);
  return { access: accountAccess(status), connecting, error };
}

/**
 * The explanation and next step shown in place of an account feature. Waitlist
 * and half-finished connections lead to their progress in Settings rather than
 * starting another connection.
 */
function useAccountExplanation(feature: AccountFeature) {
  const { access, connecting, error } = useAccountAccess();
  const { reason } = ACCOUNT_FEATURES[feature];
  const message =
    access === 'waitlist'
      ? `${reason} It opens once your account is approved.`
      : access === 'pending'
        ? `${reason} Finish connecting your account in your browser.`
        : access === 'unavailable'
          ? 'Account features are available in the Jackalope desktop app.'
          : `${reason} Connect a free Jackalope account to use it.`;
  const action =
    access === 'none' ? (
      <Button
        variant="outline"
        loading={connecting}
        loadingLabel="Connecting…"
        onClick={() => void useAccountStore.getState().connect()}
      >
        Connect account
      </Button>
    ) : access === 'loading' ? (
      <Button variant="outline" onClick={() => void useAccountStore.getState().load(true)}>
        Retry
      </Button>
    ) : access === 'waitlist' || access === 'pending' ? (
      <Button variant="outline" onClick={() => openSettings('Jackalope account')}>
        {access === 'waitlist' ? 'View waitlist progress' : 'Show connection code'}
      </Button>
    ) : null;
  return { access, message, action, error };
}

/** An inline note for a feature that keeps local controls but needs an account to sync. */
export function AccountRequiredNotice({ feature }: { feature: AccountFeature }) {
  const { access, message, action, error } = useAccountExplanation(feature);
  if (access === 'approved' || (access === 'loading' && !error)) return null;
  return (
    <InlineNotice className="account-required" action={action}>
      <p>{message}</p>
      {error && (
        <p role="alert" className="settings-row-description">
          {error}
        </p>
      )}
    </InlineNotice>
  );
}

/**
 * Renders `children` only for an approved account; otherwise explains why the
 * feature needs one and offers to connect. Children never mount without an
 * account, so they never ask the native host to call the service.
 */
export function RequiresAccount({
  feature,
  variant = 'card',
  children,
}: {
  feature: AccountFeature;
  /** `inline` sits inside an existing card instead of adding one. */
  variant?: 'card' | 'inline';
  children: ReactNode;
}) {
  const { access, message, action, error } = useAccountExplanation(feature);
  if (access === 'approved') return children;
  if (access === 'loading' && !error)
    return <LoadingState compact label="Reading account connection…" />;
  if (variant === 'inline') return <AccountRequiredNotice feature={feature} />;
  return (
    <SettingGroup
      className="account-required"
      title={ACCOUNT_FEATURES[feature].title}
      description={message}
    >
      {error && (
        <SettingBody>
          <p role="alert" className="settings-row-description">
            {error}
          </p>
        </SettingBody>
      )}
      {action && <SettingActions>{action}</SettingActions>}
    </SettingGroup>
  );
}

/** A Connect button for a feature whose own copy already explains the account. */
export function ConnectAccountButton() {
  const { access, connecting } = useAccountAccess();
  if (access !== 'none') return null;
  return (
    <Button
      variant="outline"
      loading={connecting}
      loadingLabel="Connecting…"
      onClick={() => void useAccountStore.getState().connect()}
    >
      Connect account
    </Button>
  );
}
