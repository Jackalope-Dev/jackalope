import { Bot, Check, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { type CommitPolicy, projectGitPolicy } from '../../lib/project-git';
import { Setting, SettingActions, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { Switch } from '../ui/Switch';

const choices = [
  {
    value: 'user',
    title: 'Only me',
    description: 'Your name and email on the final commit.',
    icon: UserRound,
  },
  {
    value: 'coAuthor',
    title: 'Me + agents',
    description: 'You author the commit; agents are credited as co-authors.',
    icon: UsersRound,
  },
  {
    value: 'agent',
    title: 'Agents',
    description: 'The agent authors the commit using a labeled agent identity.',
    icon: Bot,
  },
] as const;

export function ProjectGitSettings({
  projectPath,
  onDraftChange,
  disabled = false,
}: {
  projectPath: string;
  onDraftChange?: (policy: CommitPolicy | undefined) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [policy, setPolicy] = useState<CommitPolicy>();
  const [saved, setSaved] = useState<CommitPolicy>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setPolicy(undefined);
    setSaved(undefined);
    setError('');
    setNotice(retry ? 'Retrying repository settings…' : '');
    void projectGitPolicy(projectPath)
      .then((value) => {
        if (current) {
          setNotice('');
          setPolicy(value);
          setSaved(value);
        }
      })
      .catch((cause) => {
        if (current) setError(String(cause));
      });
    return () => {
      current = false;
    };
  }, [projectPath, retry]);
  useEffect(() => {
    onDraftChange?.(policy);
  }, [policy, onDraftChange]);
  const save = async () => {
    if (!policy || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await projectGitPolicy(projectPath, policy);
      setPolicy(next);
      setSaved(next);
      setNotice('Commit settings saved for this repository.');
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const dirty = JSON.stringify(policy) !== JSON.stringify(saved);
  return (
    <SettingGroup title="Commits and cleanup">
      {policy && (
        <fieldset disabled={busy || disabled} className="project-git-fields">
          <legend className="sr-only">Commit attribution</legend>
          <SettingBody>
            <div className="grid gap-2">
              {choices.map(({ value, title, description, icon: Icon }) => (
                <label
                  key={value}
                  className="flex items-center gap-3 min-h-11 p-3 cursor-pointer rounded-lg border border-[var(--color-border)] has-[:checked]:bg-[var(--color-accent-subtle)]"
                >
                  <input
                    type="radio"
                    name={`${id}-attribution`}
                    value={value}
                    checked={policy.attribution === value}
                    onChange={() => {
                      setNotice('');
                      setPolicy({ ...policy, attribution: value });
                    }}
                  />
                  <Icon size={20} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0">
                    <strong className="block text-sm">{title}</strong>
                    <span className="task-muted text-sm">{description}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor={`${id}-name`} className="task-label">
                Your commit name
                <Input
                  id={`${id}-name`}
                  value={policy.name}
                  onChange={(e) => setPolicy({ ...policy, name: e.target.value })}
                />
              </label>
              <label htmlFor={`${id}-email`} className="task-label">
                Your commit email
                <Input
                  id={`${id}-email`}
                  type="email"
                  value={policy.email}
                  onChange={(e) => setPolicy({ ...policy, email: e.target.value })}
                />
              </label>
            </div>
          </SettingBody>
          <Setting title="Save checkpoints after successful tasks">
            <Switch
              label="Save checkpoints after successful tasks"
              checked={policy.autoCheckpoint !== false}
              onCheckedChange={(autoCheckpoint) => setPolicy({ ...policy, autoCheckpoint })}
            />
          </Setting>
          <Setting title="Remove worktree and branch after approval">
            <Switch
              label="Remove worktree and branch after approval"
              checked={policy.cleanupAfterMerge}
              onCheckedChange={(cleanupAfterMerge) => setPolicy({ ...policy, cleanupAfterMerge })}
            />
          </Setting>
        </fieldset>
      )}
      {(!policy || notice || error) && (
        <SettingBody>
          {!policy && !error && (
            <p role="status" className="task-muted">
              Reading repository settings…
            </p>
          )}
          {notice && <InlineNotice role="status">{notice}</InlineNotice>}
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          {!policy && error && (
            <div>
              <Button variant="outline" onClick={() => setRetry(retry + 1)}>
                Retry settings
              </Button>
            </div>
          )}
        </SettingBody>
      )}
      {policy && !onDraftChange && (
        <SettingActions>
          <Button
            variant="outline"
            disabled={
              busy ||
              disabled ||
              !dirty ||
              (policy.attribution !== 'agent' &&
                (!policy.name.trim() || !policy.email.includes('@')))
            }
            onClick={() => void save()}
            loading={busy}
            loadingLabel="Saving…"
          >
            <Check size={16} />
            Save commit settings
          </Button>
          {dirty && <span className="task-muted text-sm">Save to apply these choices.</span>}
        </SettingActions>
      )}
    </SettingGroup>
  );
}
