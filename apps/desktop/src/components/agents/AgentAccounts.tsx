import * as Dialog from '@radix-ui/react-dialog';
import { Check, Circle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  type AccountStatus,
  type AgentProfile,
  type AgentProfilesView,
  accountStatusLabel,
  checkAgentProfile,
  createAgentProfile,
  deleteAgentProfile,
  listAgentProfiles,
  renameAgentProfile,
  setActiveAgentProfile,
  setAgentProfileGroup,
} from '../../lib/agent-profiles';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';

const AgentSignIn = lazy(() =>
  import('./AgentSignIn').then((module) => ({ default: module.AgentSignIn })),
);
function AccountGroup({
  value,
  onChange,
  label,
}: {
  value: AgentProfile['group'];
  onChange: (value: AgentProfile['group']) => void;
  label: string;
}) {
  return (
    <Select
      aria-label={label}
      value={value ?? 'none'}
      onValueChange={(value) => onChange(value === 'none' ? null : (value as 'work' | 'personal'))}
    >
      <SelectItem value="work">Work</SelectItem>
      <SelectItem value="personal">Personal</SelectItem>
      <SelectItem value="none">Ungrouped</SelectItem>
    </Select>
  );
}
function EditAccount({
  profile,
  onSave,
  onClose,
}: {
  profile: AgentProfile;
  onSave: (name: string, group: AgentProfile['group']) => Promise<void>;
  onClose: () => void;
}) {
  const dialogFocus = useDialogFocus();
  const [name, setName] = useState(profile.name);
  const [group, setGroup] = useState(profile.group);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content
          {...dialogFocus}
          className="task-dialog appearance-panel confirm-action-dialog"
        >
          <Dialog.Title className="text-xl font-medium">Edit account</Dialog.Title>
          <Dialog.Description className="task-muted mt-2">
            Group accounts to choose Work or Personal across agents in Project settings.
          </Dialog.Description>
          <form
            className="grid gap-4 mt-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await onSave(name.trim(), group);
                onClose();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="task-label">
              Account name
              <input
                className="task-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                required
                maxLength={80}
              />
            </label>
            <AccountGroup value={group} onChange={setGroup} label="Account group" />
            {error && (
              <p role="alert" className="task-error">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? 'Saving…' : 'Save account'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function AgentAccounts({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [view, setView] = useState<AgentProfilesView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [group, setGroup] = useState<AgentProfile['group']>('work');
  const [busy, setBusy] = useState('');
  const [statuses, setStatuses] = useState<Record<string, AccountStatus | undefined>>({});
  const [signIn, setSignIn] = useState<AgentProfile>();
  const signInOpener = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<AgentProfile>();
  const desktop = isTauriEnvironment();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setView(await listAgentProfiles(agentId));
    } finally {
      setLoading(false);
    }
  }, [agentId]);
  useEffect(() => {
    let cancelled = false;
    setView(undefined);
    setStatuses({});
    if (!desktop) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void listAgentProfiles(agentId)
      .then((view) => {
        if (!cancelled) {
          setView(view);
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, desktop]);
  const action = async (id: string, run: () => Promise<void>) => {
    setBusy(id);
    setError('');
    try {
      await run();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  };
  const check = async (profile: AgentProfile) => {
    setStatuses((old) => ({ ...old, [profile.id]: undefined }));
    const status = await checkAgentProfile(agentId, profile.id);
    setStatuses((old) => ({ ...old, [profile.id]: status }));
  };
  if (!desktop) return <p className="task-muted">Accounts are available in the desktop app.</p>;
  if (!view)
    return (
      <div>
        {error && (
          <p role="alert" className="task-error">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading accounts…</p>
        ) : (
          <Button variant="outline" onClick={() => void action('load', load)}>
            Retry accounts
          </Button>
        )}
      </div>
    );
  if (!view.envVar)
    return (
      <p className="task-muted">
        {agentId === 'antigravity'
          ? 'Antigravity uses the current agy sign-in. Separate accounts are not supported yet; changing that sign-in also changes the account used by existing tasks.'
          : `Separate accounts are not available for ${agentName}.`}
      </p>
    );
  const locked = !!busy || loading;
  return (
    <div className="agent-accounts">
      <p className="task-muted">Keep separate sign-ins for work and personal projects.</p>
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        disabled={locked || !view.activeId}
        onClick={() =>
          void action('default', async () => {
            await setActiveAgentProfile(agentId, null);
            await load();
          })
        }
      >
        {view.activeId ? 'Use normal CLI sign-in' : 'Using normal CLI sign-in'}
      </Button>
      <ul className="agent-accounts-list">
        {view.profiles.map((profile) => {
          const status = statuses[profile.id];
          const active = profile.id === view.activeId;
          return (
            <li key={profile.id} className="agent-accounts-row">
              <button
                type="button"
                className="agent-account-select"
                aria-pressed={active}
                aria-label={`Use ${profile.name} for new ${agentName} tasks`}
                disabled={locked}
                onClick={() =>
                  void action(profile.id, async () => {
                    await setActiveAgentProfile(agentId, profile.id);
                    await load();
                  })
                }
              >
                {active ? <Check size={18} /> : <Circle size={18} />}
              </button>
              <div className="agent-account-identity">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{profile.name}</strong>
                  {profile.group && (
                    <span className="task-muted text-xs">
                      {profile.group === 'work' ? 'Work' : 'Personal'}
                    </span>
                  )}
                  {active && <span className="task-muted text-xs">Default for new tasks</span>}
                </div>
                <p className="task-muted text-sm" role="status">
                  {busy === `check-${profile.id}` ? 'Checking…' : accountStatusLabel(status)}
                  {status?.identity && ` · ${status.identity}`}
                </p>
                {status && (
                  <p className="task-muted text-xs" title={status.detail}>
                    Checked{' '}
                    {new Date(status.checkedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {status.state === 'unknown' ||
                    status.state === 'configured' ||
                    status.state === 'notInstalled'
                      ? ` · ${status.detail}`
                      : ''}
                  </p>
                )}
              </div>
              <div className="agent-accounts-actions">
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={(event) => {
                    signInOpener.current = event.currentTarget;
                    setSignIn(profile);
                  }}
                >
                  Sign in
                </Button>
                <Button
                  variant="ghost"
                  disabled={locked}
                  aria-label={`Check ${profile.name} sign-in`}
                  title="Check sign-in"
                  onClick={() => void action(`check-${profile.id}`, () => check(profile))}
                >
                  <RefreshCw size={16} />
                </Button>
                <Button
                  variant="ghost"
                  disabled={locked}
                  aria-label={`Edit ${profile.name}`}
                  onClick={() => setEditing(profile)}
                >
                  <Pencil size={16} />
                </Button>
                <ConfirmAction
                  title="Remove account?"
                  description={`Remove ${profile.name} and its sign-in data? Projects and existing tasks using it will need attention. The normal CLI sign-in is kept.`}
                  label="Remove account"
                  onConfirm={async () => {
                    await deleteAgentProfile(agentId, profile.id);
                    await load();
                  }}
                  trigger={
                    <Button variant="ghost" disabled={locked} aria-label={`Remove ${profile.name}`}>
                      <Trash2 size={16} />
                    </Button>
                  }
                />
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className="agent-account-add"
        onSubmit={(e) => {
          e.preventDefault();
          signInOpener.current =
            (e.nativeEvent as SubmitEvent).submitter ??
            (document.activeElement instanceof HTMLElement ? document.activeElement : null);
          void action('add', async () => {
            const profile = await createAgentProfile(
              agentId,
              name.trim() || (group === 'personal' ? 'Personal' : 'Work'),
              group,
            );
            setName('');
            await load();
            setSignIn(profile);
          });
        }}
      >
        <AccountGroup value={group} onChange={setGroup} label={`New ${agentName} account group`} />
        <input
          className="task-input"
          disabled={locked}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            group === 'personal' ? 'Personal' : group === 'work' ? 'Work' : 'Account name'
          }
          aria-label={`New ${agentName} account name`}
          maxLength={80}
        />
        <Button type="submit" disabled={locked || (!group && !name.trim())}>
          <Plus size={16} />
          {busy === 'add' ? 'Adding…' : 'Add & sign in'}
        </Button>
      </form>
      {editing && (
        <EditAccount
          profile={editing}
          onClose={() => setEditing(undefined)}
          onSave={async (name, group) => {
            await renameAgentProfile(agentId, editing.id, name);
            await setAgentProfileGroup(agentId, editing.id, group);
            await load();
          }}
        />
      )}
      {signIn && (
        <Suspense fallback={<p role="status">Opening sign-in…</p>}>
          <AgentSignIn
            agentId={agentId}
            agentName={agentName}
            profileId={signIn.id}
            profileName={signIn.name}
            returnFocus={signInOpener.current}
            onClose={() => setSignIn(undefined)}
            onStatus={(status) => setStatuses((old) => ({ ...old, [signIn.id]: status }))}
          />
        </Suspense>
      )}
    </div>
  );
}
