import { useEffect, useId } from 'react';
import { accountStatusLabel } from '../../lib/agent-profiles';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { accountProfiles, useAgentAccountsStore } from '../../stores/agentAccountsStore';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';

export function OnboardingAgentAccount({
  agentId,
  agentName,
  value,
  blocked = [],
  disabled,
  onChange,
}: {
  agentId: string;
  agentName: string;
  value?: string;
  blocked?: string[];
  disabled: boolean;
  onChange: (id: string | undefined) => void;
}) {
  const id = useId();
  const entry = useAgentAccountsStore((state) => state.agents[agentId]);
  const appBlocked = useAgentConfigStore((state) => state.disabledAccounts[agentId]);
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
  const label = (account: (typeof accounts)[number]) => {
    const identity = entry?.statuses[account.id]?.identity;
    return [account.name, identity !== account.name ? identity : null, account.tag]
      .filter(Boolean)
      .join(' · ');
  };
  return (
    <div className="onboarding-agent-account">
      {entry?.error ? (
        <div>
          <p className="task-error" role="alert">
            Could not load {agentName} accounts.
          </p>
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
            <p className="task-error" role="alert">
              The saved account is unavailable. Choose another account.
            </p>
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
          {status?.state === 'signedOut' && (
            <p className="task-muted">
              Sign in to this account in Settings → Agents before starting a task.
            </p>
          )}
        </>
      ) : (
        <p className="task-muted" role="status">
          No enabled accounts. Enable an account in Settings → Agents.
        </p>
      )}
    </div>
  );
}
