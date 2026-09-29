import * as Dialog from '@radix-ui/react-dialog';
import { Columns2, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getAgentMetadata } from '../../lib/agent-catalog';
import {
  elapsedLabel,
  isActive,
  nativeTask,
  statusLabel,
  type TaskRun,
} from '../../lib/task-runtime';
import { latestAttempt } from '../../lib/task-workflow';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { comparisonForTask, useCompareStore } from '../../stores/compareStore';
import { useExecutionStore } from '../../stores/executionStore';
import { AgentAvatar } from '../agents/AgentAvatar';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { DismissButton } from '../ui/DismissButton';
import { InlineNotice } from '../ui/InlineNotice';
import './task-comparison.css';

interface Stats {
  files: number;
  added: number;
  removed: number;
}

function duration(run: TaskRun) {
  if (run.durationMs != null) {
    const seconds = Math.round(run.durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
  }
  return run.endedAt
    ? elapsedLabel(run.startedAt, Date.parse(run.endedAt))
    : elapsedLabel(run.startedAt);
}

/** Agent summaries are Markdown; the card shows a plain-text excerpt. */
function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>]+/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkLabel(run: TaskRun) {
  if (!run.verification) return run.verifyCommand ? 'Not run' : 'No check';
  return run.verification.result.success ? 'Passed' : 'Failed';
}

/**
 * Shown on a task that was started as one of several agents answering the same
 * prompt. Lets the user move between the attempts and compare their outcomes.
 */
export function TaskComparison({ run }: { run: TaskRun }) {
  const comparison = useCompareStore((state) => comparisonForTask(state.comparisons, run.taskId));
  const { runs, runners } = useExecutionStore(
    useShallow((state) => ({ runs: state.runs, runners: state.runners })),
  );
  const customAgents = useAgentConfigStore(useShallow((state) => state.customAgents));
  const [open, setOpen] = useState(false);
  if (!comparison) return null;
  const members = comparison.taskIds
    .map((taskId) => latestAttempt(runs, taskId))
    .filter((member): member is TaskRun => !!member);
  if (members.length < 2 && !comparison.failures?.length) return null;
  const adapter = (agent: string) =>
    customAgents.find((custom) => custom.id === agent)?.adapter ?? agent;
  const name = (agent: string) =>
    runners.find((runner) => runner.id === agent)?.name ??
    customAgents.find((custom) => custom.id === agent)?.name ??
    getAgentMetadata(agent)?.name ??
    agent;
  const running = members.filter(isActive).length;
  return (
    <section className="task-comparison" aria-label="Compared agents">
      <div className="task-comparison-summary">
        <Columns2 size={16} aria-hidden="true" />
        <span>
          {running
            ? `${members.length} agents · ${running} still working`
            : `${members.length} agents finished`}
        </span>
      </div>
      <ul className="task-comparison-members">
        {members.map((member) => (
          <li key={member.id}>
            <button
              type="button"
              className="task-comparison-member"
              aria-current={member.taskId === run.taskId ? 'true' : undefined}
              onClick={() => useExecutionStore.getState().select(member.id)}
            >
              <AgentAvatar provider={adapter(member.agent)} size="xs" working={isActive(member)} />
              <span>{name(member.agent)}</span>
              <small>{statusLabel[member.status]}</small>
              {comparison.chosenTaskId === member.taskId && (
                <Trophy size={14} aria-label="Kept" className="task-comparison-kept" />
              )}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Compare results
      </Button>
      {comparison.failures?.map((failure) => (
        <InlineNotice
          key={failure}
          tone="warning"
          action={
            <DismissButton
              label="Dismiss start failure"
              onDismiss={() => useCompareStore.getState().dismissFailure(comparison.id, failure)}
            />
          }
        >
          Did not start · {failure}
        </InlineNotice>
      ))}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        {open && (
          <ComparisonDialog
            comparisonId={comparison.id}
            prompt={comparison.prompt}
            chosenTaskId={comparison.chosenTaskId}
            members={members}
            adapter={adapter}
            name={name}
            onClose={() => setOpen(false)}
          />
        )}
      </Dialog.Root>
    </section>
  );
}

function ComparisonDialog({
  comparisonId,
  prompt,
  chosenTaskId,
  members,
  adapter,
  name,
  onClose,
}: {
  comparisonId: string;
  prompt: string;
  chosenTaskId?: string;
  members: TaskRun[];
  adapter: (agent: string) => string;
  name: (agent: string) => string;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<Record<string, Stats | 'error'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const finishedIds = members
    .filter((member) => !isActive(member))
    .map((member) => member.id)
    .join(',');
  useEffect(() => {
    let canceled = false;
    const ids = finishedIds.split(',').filter(Boolean);
    if (ids.length)
      nativeTask<Record<string, Stats>>('task_change_stats', { ids })
        .then((result) => {
          if (!canceled) setStats(Object.fromEntries(ids.map((id) => [id, result[id] ?? 'error'])));
        })
        .catch(() => {
          if (!canceled) setStats(Object.fromEntries(ids.map((id) => [id, 'error'])));
        });
    return () => {
      canceled = true;
    };
  }, [finishedIds]);
  const keep = async (winner: TaskRun) => {
    setBusy(true);
    setError('');
    const failures: string[] = [];
    for (const member of members) {
      if (member.taskId === winner.taskId || isActive(member) || member.archivedAt) continue;
      try {
        await nativeTask('task_set_archived', { id: member.id, archived: true });
      } catch (cause) {
        failures.push(`${name(member.agent)}: ${String(cause)}`);
      }
    }
    useCompareStore.getState().choose(comparisonId, winner.taskId);
    await useExecutionStore.getState().refresh();
    setBusy(false);
    if (failures.length) {
      setError(`Some attempts could not be archived. ${failures.join(' ')}`);
      return;
    }
    useExecutionStore.getState().select(winner.id);
    onClose();
  };
  return (
    <DialogContent className="task-comparison-dialog" aria-describedby="task-comparison-prompt">
      <DialogHeader title="Compare results" />
      <DialogCloseButton />
      <p id="task-comparison-prompt" className="task-comparison-prompt">
        {prompt}
      </p>
      <div className="task-comparison-grid">
        {members.map((member) => {
          const stat = stats[member.id];
          const active = isActive(member);
          return (
            <article
              key={member.id}
              className="task-comparison-card"
              data-kept={chosenTaskId === member.taskId || undefined}
            >
              <header>
                <AgentAvatar provider={adapter(member.agent)} size="sm" working={active} />
                <div>
                  <h3>{name(member.agent)}</h3>
                  <p>{member.model ?? member.account}</p>
                </div>
              </header>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{statusLabel[member.status]}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{duration(member) || '—'}</dd>
                </div>
                <div>
                  <dt>Check</dt>
                  <dd
                    data-tone={member.verification?.result.success === false ? 'danger' : undefined}
                  >
                    {checkLabel(member)}
                  </dd>
                </div>
                <div>
                  <dt>Changes</dt>
                  <dd>
                    {active ? (
                      'In progress'
                    ) : !stat ? (
                      'Loading…'
                    ) : stat === 'error' ? (
                      'Unavailable'
                    ) : stat.files ? (
                      <>
                        {stat.files} {stat.files === 1 ? 'file' : 'files'}{' '}
                        <span className="task-comparison-added">+{stat.added}</span>{' '}
                        <span className="task-comparison-removed">−{stat.removed}</span>
                      </>
                    ) : (
                      'No changes'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>
                    {member.usage.reported
                      ? (member.usage.input + member.usage.output).toLocaleString()
                      : 'Not reported'}
                  </dd>
                </div>
              </dl>
              {member.result && (
                <p className="task-comparison-result">{plainText(member.result)}</p>
              )}
              <div className="task-comparison-actions">
                <Button
                  variant="outline"
                  onClick={() => {
                    useExecutionStore.getState().select(member.id);
                    onClose();
                  }}
                >
                  Open
                </Button>
                <Button
                  disabled={busy || !['review', 'reviewed'].includes(member.status)}
                  onClick={() => void keep(member)}
                >
                  Keep this one
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <DialogFooter>
        <p className="task-comparison-footnote">
          Keeping one archives the other finished attempts. Archived work, branches and worktrees
          stay available to restore.
        </p>
      </DialogFooter>
    </DialogContent>
  );
}
