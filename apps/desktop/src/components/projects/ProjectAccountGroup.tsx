import { useState } from 'react';
import { accountGroupChoices } from '../../lib/account-groups';
import { listAgentProfiles } from '../../lib/agent-profiles';
import { Button } from '../ui/button';
import { LoadingState } from '../ui/LoadingState';
export function ProjectAccountGroup({
  agents,
  value,
  onChange,
}: {
  agents: { id: string; name: string }[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const [choice, setChoice] = useState<'work' | 'personal'>();
  const [preview, setPreview] = useState<ReturnType<typeof accountGroupChoices>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const names = (ids: string[]) =>
    ids.map((id) => agents.find((a) => a.id === id)?.name ?? id).join(', ');
  const load = async (group: 'work' | 'personal') => {
    const entries = await Promise.all(
      agents
        .filter((a) => ['codex', 'claude', 'grok', 'opencode', 'kimi'].includes(a.id))
        .map(async (agent) => ({
          agent: agent.id,
          profiles: (await listAgentProfiles(agent.id)).profiles,
        })),
    );
    return accountGroupChoices(entries, group);
  };
  const select = async (group: 'work' | 'personal') => {
    setBusy(true);
    setError('');
    setChoice(group);
    setPreview(undefined);
    try {
      setPreview(await load(group));
    } catch {
      setError('Could not load account groups. Choose the group again to retry.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-group p-5">
      <h2 className="text-base font-medium">Accounts for this project</h2>
      <p className="task-muted mt-2">
        Choose a group across agents, or select individual accounts below.
      </p>
      <div className="flex flex-wrap gap-3 mt-3">
        <Button
          variant="outline"
          disabled={busy}
          aria-pressed={choice === 'work'}
          onClick={() => void select('work')}
        >
          Work accounts
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          aria-pressed={choice === 'personal'}
          onClick={() => void select('personal')}
        >
          Personal accounts
        </Button>
      </div>
      {busy && <LoadingState label={'Checking accounts…'} compact />}
      {error && (
        <p role="alert" className="task-error mt-3">
          {error}
        </p>
      )}
      {preview && (
        <div className="mt-3 grid gap-3">
          {!!Object.keys(preview.assignments).length && (
            <p>
              Use {choice} accounts for {names(Object.keys(preview.assignments))}.
            </p>
          )}
          {!!preview.missing.length && (
            <p className="task-muted">
              No {choice} account for {names(preview.missing)}. Their current selections will be
              kept.
            </p>
          )}
          {!!preview.ambiguous.length && (
            <p className="task-error">
              Multiple {choice} accounts for {names(preview.ambiguous)}. Choose those accounts
              individually below.
            </p>
          )}
          <div>
            <Button
              disabled={busy || !Object.keys(preview.assignments).length}
              onClick={async () => {
                if (!choice) return;
                setBusy(true);
                setError('');
                try {
                  const latest = await load(choice);
                  if (JSON.stringify(latest) !== JSON.stringify(preview)) {
                    setPreview(latest);
                    setError('Accounts changed. Review the updated choices and apply again.');
                    return;
                  }
                  onChange({ ...value, ...latest.assignments });
                  setPreview(undefined);
                  setChoice(undefined);
                } catch {
                  setError('Could not apply accounts. Retry when accounts are available.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Apply {Object.keys(preview.assignments).length} account
              {Object.keys(preview.assignments).length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
