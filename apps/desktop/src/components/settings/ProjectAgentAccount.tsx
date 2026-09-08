import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { type AgentProfilesView, listAgentProfiles } from '../../lib/agent-profiles';
import { AgentAccounts } from '../agents/AgentAccounts';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import '../agents/agent-manager.css';
export function ProjectAgentAccount({
  agentId,
  agentName,
  projectName,
  value,
  onChange,
}: {
  agentId: string;
  agentName: string;
  projectName: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const [view, setView] = useState<AgentProfilesView>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload after managing accounts or retrying a failed read.
  useEffect(() => {
    let cancelled = false;
    setError('');
    void listAgentProfiles(agentId)
      .then((view) => {
        if (!cancelled) setView(view);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, refresh]);
  if (view && !view.envVar && !value) return null;
  const missing = value && view && !view.profiles.some((p) => p.id === value);
  return (
    <div className="project-agent-account">
      <span className="task-muted text-xs">
        {agentName} account for {projectName}
      </span>
      {error && (
        <div>
          <p role="alert" className="task-error">
            Could not load accounts. Your saved selection is kept.
          </p>
          <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
            Retry accounts
          </Button>
        </div>
      )}
      {missing && (
        <p role="alert" className="task-error">
          The selected account was removed. Choose another account before starting work.
        </p>
      )}
      <p className="task-muted text-xs">
        Automatic tasks choose an account by task fit and quota. A specific selection limits this
        agent to that account; manually assigned tasks use its active account when set to automatic.
      </p>
      {view && (
        <Select
          aria-label={`${agentName} account for ${projectName}`}
          value={value ?? 'inherit'}
          onValueChange={(next) => onChange(next === 'inherit' ? undefined : next)}
        >
          <SelectItem value="inherit">Automatic · all configured accounts</SelectItem>
          {missing && (
            <SelectItem value={value} disabled>
              Removed account
            </SelectItem>
          )}
          {view.profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.name}
              {profile.group ? ` · ${profile.group === 'work' ? 'Work' : 'Personal'}` : ''}
            </SelectItem>
          ))}
        </Select>
      )}
      {!view && !error && (
        <p role="status" className="task-muted">
          Loading accounts…
        </p>
      )}
      {view?.envVar && (
        <Dialog.Root
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setRefresh((n) => n + 1);
          }}
        >
          <Dialog.Trigger asChild>
            <Button variant="ghost">
              {view.profiles.length ? 'Manage accounts' : 'Add account'}
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="task-dialog-overlay" />
            <Dialog.Content className="task-dialog appearance-panel agent-sign-in-dialog">
              <Dialog.Title className="text-xl font-medium">{agentName} accounts</Dialog.Title>
              <Dialog.Description className="task-muted mt-2 mb-4">
                Add an account here, then select it for {projectName}.
              </Dialog.Description>
              <AgentAccounts key={agentId} agentId={agentId} agentName={agentName} />
              <div className="flex justify-end mt-4">
                <Dialog.Close asChild>
                  <Button variant="outline">Done</Button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}
