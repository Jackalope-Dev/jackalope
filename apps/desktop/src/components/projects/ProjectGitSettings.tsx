import { Bot, Check, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { type CommitPolicy, projectGitPolicy } from '../../lib/project-git';
import { Button } from '../ui/button';
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
}: {
  projectPath: string;
  onDraftChange?: (policy: CommitPolicy | undefined) => void;
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
    onDraftChange?.(JSON.stringify(policy) !== JSON.stringify(saved) ? policy : undefined);
  }, [policy, saved, onDraftChange]);
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
    <section className="project-preferences-section py-5" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Commits and cleanup</h2>
      <p className="task-muted mt-2 mb-4">
        Jackalope saves a checkpoint when a task succeeds and suggests its commit message. Review
        the result, then merge. Jackalope creates one commit and can remove the finished worktree
        and branch.
      </p>
      {policy ? (
        <>
          <fieldset disabled={busy} className="grid gap-2">
            <legend className="task-label mb-2">Who gets credit?</legend>
            {choices.map(({ value, title, description, icon: Icon }) => (
              <label
                key={value}
                className="flex items-center gap-3 min-h-11 p-3 cursor-pointer rounded-lg border border-[var(--color-border)] has-[:checked]:bg-[var(--color-surface-elevated)]"
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
            <div className="grid gap-3 sm:grid-cols-2 mt-3">
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
            <p className="task-muted text-sm">
              Starts with your Git identity. Use the email associated with your account, including a
              private commit email if preferred. These settings stay local to this repository.
            </p>
            <div className="flex items-center justify-between gap-4 min-h-11 mt-2">
              <span className="text-sm">Save checkpoints after successful tasks</span>
              <Switch
                label="Save checkpoints after successful tasks"
                checked={policy.autoCheckpoint !== false}
                onCheckedChange={(autoCheckpoint) => setPolicy({ ...policy, autoCheckpoint })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 min-h-11 mt-2">
              <span className="text-sm">Remove worktree and branch after approval</span>
              <Switch
                label="Remove worktree and branch after approval"
                checked={policy.cleanupAfterMerge}
                onCheckedChange={(cleanupAfterMerge) => setPolicy({ ...policy, cleanupAfterMerge })}
              />
            </div>
          </fieldset>
          <Button
            className="mt-4"
            variant="outline"
            disabled={
              busy ||
              !dirty ||
              (policy.attribution !== 'agent' &&
                (!policy.name.trim() || !policy.email.includes('@')))
            }
            onClick={() => void save()}
          >
            <Check size={16} />
            {busy ? 'Saving…' : 'Save commit settings'}
          </Button>
          {dirty && (
            <p className="task-muted text-sm mt-2">
              {onDraftChange
                ? 'Continue saves these choices for this repository.'
                : 'Save to apply these choices.'}
            </p>
          )}
        </>
      ) : (
        !error && (
          <p role="status" className="task-muted">
            Reading repository settings…
          </p>
        )
      )}
      {notice && (
        <p role="status" className="task-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {!policy && error && (
        <Button variant="outline" onClick={() => setRetry(retry + 1)}>
          Retry settings
        </Button>
      )}
    </section>
  );
}
