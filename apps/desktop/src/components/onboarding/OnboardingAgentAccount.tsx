import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import {
  type AccountStatus,
  accountStatusLabel,
  checkAgentProfile,
} from '../../lib/agent-profiles';
import { isTauriEnvironment } from '../../lib/native/env';
import { accountProfiles, profileId, useAgentAccountsStore } from '../../stores/agentAccountsStore';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';

const AgentSignIn = lazy(() =>
  import('../agents/AgentSignIn').then((module) => ({ default: module.AgentSignIn })),
);

export function OnboardingAgentAccount({
  agentId,
  agentName,
  value,
  blocked = [],
  disabled,
  onChange,
  onUnblock,
  onSignedIn,
}: {
  agentId: string;
  agentName: string;
  value?: string;
  blocked?: string[];
  disabled: boolean;
  onChange: (id: string | undefined) => void;
  /** Clears this project's account blocks for the agent. */
  onUnblock: () => void;
  onSignedIn: () => void;
}) {
  const id = useId();
  const entry = useAgentAccountsStore((state) => state.agents[agentId]);
  const appBlocked = useAgentConfigStore((state) => state.disabledAccounts[agentId]);
  const [signIn, setSignIn] = useState<{ id: string; name: string }>();
  const [failure, setFailure] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const previous = useRef<AccountStatus | undefined>(undefined);
  useEffect(() => {
    if (isTauriEnvironment()) void useAgentAccountsStore.getState().load(agentId);
  }, [agentId]);
  const accounts = entry?.view
    ? accountProfiles(entry.view, entry.statuses).filter(
        (account) => !blocked.includes(account.id) && !appBlocked?.includes(account.id),
      )
    : [];
  const selected = accounts.find((account) => account.id === value);
  const status = selected ? entry?.statuses[selected.id] : undefined;
  const ready = (accountId: string) =>
    ['signedIn', 'configured'].includes(entry?.statuses[accountId]?.state ?? '');
  // Antigravity accounts connect with an API key on the Agents page, not a provider sign-in.
  // The open sign-in keeps its button so focus can return to it.
  const signInTarget =
    agentId === 'antigravity'
      ? undefined
      : signIn
        ? accounts.find((account) => account.id === signIn.id)
        : selected
          ? status?.state === 'signedOut'
            ? selected
            : undefined
          : accounts.some((account) => ready(account.id))
            ? undefined
            : accounts.find((account) => entry?.statuses[account.id]?.state === 'signedOut');
  const label = (account: (typeof accounts)[number]) => {
    const identity = entry?.statuses[account.id]?.identity;
    return [account.name, identity !== account.name ? identity : null, account.tag]
      .filter(Boolean)
      .join(' · ');
  };
  const unblock = async () => {
    setFailure('');
    onUnblock();
    const before = useAgentConfigStore.getState().disabledAccounts;
    if (!before[agentId]?.length) return;
    useAgentConfigStore.setState({ disabledAccounts: { ...before, [agentId]: [] } });
    try {
      await syncAgentConfig();
    } catch (cause) {
      useAgentConfigStore.setState({ disabledAccounts: before });
      setFailure(String(cause));
    }
  };
  return (
    <div className="onboarding-agent-account">
      {entry?.error ? (
        <div>
          <InlineNotice tone="error">Could not load {agentName} accounts.</InlineNotice>
          <Button
            variant="ghost"
            disabled={disabled || entry.loading}
            onClick={() => void useAgentAccountsStore.getState().load(agentId, true)}
          >
            Retry accounts
          </Button>
        </div>
      ) : !entry?.view ? (
        <p className="task-muted" role="status">
          Checking {agentName} accounts…
        </p>
      ) : accounts.length ? (
        <>
          <label className="task-label" htmlFor={id}>
            {agentName} account
          </label>
          <Select
            id={id}
            value={value && !selected ? '' : (value ?? 'inherit')}
            placeholder="Choose account"
            disabled={disabled}
            onValueChange={(next) => onChange(next === 'inherit' ? undefined : next)}
          >
            <SelectItem value="inherit">Automatic · enabled accounts</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {label(account)}
              </SelectItem>
            ))}
          </Select>
          {value && !selected ? (
            <InlineNotice tone="error">
              The saved account is unavailable. Choose another account.
            </InlineNotice>
          ) : (
            <p className="task-muted" role="status">
              {selected
                ? status
                  ? accountStatusLabel(status)
                  : 'Checking account…'
                : accounts
                    .map(
                      (account) =>
                        `${label(account)} · ${entry.statuses[account.id] ? accountStatusLabel(entry.statuses[account.id]) : 'Checking account…'}`,
                    )
                    .join('; ')}
            </p>
          )}
          {signInTarget && (
            <div className="onboarding-account-action">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !isTauriEnvironment()}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  previous.current = entry.statuses[signInTarget.id];
                  setSignIn({ id: signInTarget.id, name: signInTarget.name });
                }}
              >
                Sign in to {agentName}
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="onboarding-account-action">
          <p className="task-muted" role="status">
            Every {agentName} account is turned off.
          </p>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => void unblock()}>
            Turn on {agentName} accounts
          </Button>
        </div>
      )}
      {failure && <InlineNotice tone="error">{failure}</InlineNotice>}
      {signIn && (
        <Suspense fallback={null}>
          <AgentSignIn
            agentId={agentId}
            agentName={agentName}
            profileId={signIn.id}
            profileName={signIn.name}
            returnFocus={opener.current}
            onStatus={(next) => {
              useAgentAccountsStore.getState().setStatus(agentId, signIn.id, next);
              if (next?.state === 'signedIn' || next?.state === 'configured') onSignedIn();
            }}
            onClose={async () => {
              const accountId = signIn.id;
              setSignIn(undefined);
              const store = useAgentAccountsStore.getState();
              const current = store.agents[agentId]?.statuses[accountId];
              if (current?.state === 'signedIn' || current?.state === 'configured') return;
              // Keep the last known status, and with it the Sign in button, while checking again.
              if (!current) store.setStatus(agentId, accountId, previous.current);
              requestAnimationFrame(() => opener.current?.focus());
              void checkAgentProfile(agentId, profileId(accountId))
                .then((next) => store.setStatus(agentId, accountId, next))
                .catch(() => {});
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
