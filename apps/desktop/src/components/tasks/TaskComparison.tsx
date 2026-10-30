import * as Dialog from '@radix-ui/react-dialog';
import { Columns2, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getAgentMetadata } from '../../lib/agent-catalog';
import {
  attemptLabel,
  buildCombinePrompt,
  type CombinePort,
  isIndependentJudge,
  parseVerdict,
  pickJudgeAgent,
} from '../../lib/compare-judge';
import { startComparisonJudge } from '../../lib/compare-launch';
import {
  durationLabel,
  elapsedLabel,
  isActive,
  nativeTask,
  statusLabel,
  type TaskRun,
} from '../../lib/task-runtime';
import { latestAttempt } from '../../lib/task-workflow';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { type Comparison, comparisonForTask, useCompareStore } from '../../stores/compareStore';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { AgentAvatar } from '../agents/AgentAvatar';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogFooter, DialogHeader } from '../ui/Dialog';
import { DismissButton } from '../ui/DismissButton';
import { InlineNotice } from '../ui/InlineNotice';
import { ComparisonJudge, type LabelledAttempt } from './ComparisonJudge';
import './task-comparison.css';

interface Stats {
  files: number;
  added: number;
  removed: number;
}

function duration(run: TaskRun) {
  if (run.durationMs != null) return durationLabel(run.durationMs / 1000);
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

const isFinished = (run: TaskRun) => ['review', 'reviewed'].includes(run.status);

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
  const judgeRun = comparison.judge ? latestAttempt(runs, comparison.judge.taskId) : undefined;
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
            comparison={comparison}
            members={members}
            judgeRun={judgeRun}
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
  comparison,
  members,
  judgeRun,
  adapter,
  name,
  onClose,
}: {
  comparison: Comparison;
  members: TaskRun[];
  judgeRun?: TaskRun;
  adapter: (agent: string) => string;
  name: (agent: string) => string;
  onClose: () => void;
}) {
  const { id: comparisonId, prompt, chosenTaskId, judge } = comparison;
  const [stats, setStats] = useState<Record<string, Stats | 'error'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const runners = useExecutionStore(useShallow((state) => state.runners));
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === comparison.projectId),
  );
  const finished = members.filter(isFinished);
  const judgeOptions = runners
    .filter((runner) => runner.available)
    .map((runner) => ({ id: runner.id, name: runner.name, adapter: adapter(runner.id) }));
  const authorAdapters = finished.map((member) => adapter(member.agent));
  const [judgeAgent, setJudgeAgent] = useState<string>();
  const judgeChoice =
    judgeOptions.find((option) => option.id === judgeAgent) ??
    judgeOptions.find((option) => option.id === pickJudgeAgent(judgeOptions, authorAdapters)?.id);
  const [judging, setJudging] = useState(false);
  const attempts: LabelledAttempt[] = (judge?.labels ?? [])
    .map((taskId, index) => {
      const run = members.find((member) => member.taskId === taskId);
      return run && { label: attemptLabel(index), run, name: name(run.agent) };
    })
    .filter((attempt): attempt is LabelledAttempt => !!attempt);
  const labelFor = (taskId: string) =>
    attempts.find((attempt) => attempt.run.taskId === taskId)?.label;
  const judgeDone = judgeRun && isFinished(judgeRun) ? judgeRun.id : '';
  const [fetched, setFetched] = useState<{ id: string; result: string }>();
  // Run summaries omit the final answer, so read the finished judge's full record once.
  useEffect(() => {
    if (!judgeDone) return;
    let canceled = false;
    nativeTask<TaskRun[]>('task_runs', { detailId: judgeDone })
      .then((all) => {
        const result = all.find((item) => item.id === judgeDone)?.result ?? '';
        if (!canceled) setFetched({ id: judgeDone, result });
      })
      .catch(() => {
        if (!canceled) setFetched({ id: judgeDone, result: '' });
      });
    return () => {
      canceled = true;
    };
  }, [judgeDone]);
  const judgeResult = judgeDone
    ? judgeRun?.result || (fetched?.id === judgeDone ? fetched.result : '')
    : '';
  const judgeLoading = !!judgeDone && !judgeResult && fetched?.id !== judgeDone;
  const labels = judge?.labels.map((_, index) => attemptLabel(index)).join(',') ?? '';
  const verdict = useMemo(
    () => (judgeResult ? parseVerdict(judgeResult, labels.split(',')) : undefined),
    [judgeResult, labels],
  );
  const [skippedPorts, setSkippedPorts] = useState<Set<number>>(new Set());
  const selectedPorts = new Set(
    (verdict?.ports ?? []).map((_, index) => index).filter((index) => !skippedPorts.has(index)),
  );
  const portsFor = (winner: TaskRun): CombinePort[] =>
    (verdict?.ports ?? []).flatMap((port, index) => {
      const source = attempts.find((attempt) => attempt.label === port.attempt)?.run;
      if (!selectedPorts.has(index) || !source || source.taskId === winner.taskId) return [];
      return [
        {
          ...port,
          agentName: name(source.agent),
          workspace: source.workspace,
          branch: source.branch,
          baseHead: source.baseHead,
        },
      ];
    });
  const startJudge = async () => {
    if (!judgeChoice || judging) return;
    setJudging(true);
    setError('');
    try {
      await startComparisonJudge({
        comparison,
        attempts: finished,
        agent: judgeChoice,
        project,
        agentName: name,
      });
      setSkippedPorts(new Set());
    } catch (cause) {
      setError(`The judge could not start. ${String(cause)}`);
    } finally {
      setJudging(false);
    }
  };
  /** Opens the kept task with an editable follow-up that brings over the selected parts. */
  const draftCombine = (winner: TaskRun, ports: CombinePort[]) => {
    const key = `reply:${winner.taskId}`;
    const execution = useExecutionStore.getState();
    const current = execution.drafts[key]?.prompt.trim() ?? '';
    const request = buildCombinePrompt(ports);
    execution.draft(key, { prompt: current ? `${current}\n\n${request}` : request });
    const sources = new Map<string, string>();
    for (const port of ports) {
      const source = attempts.find((attempt) => attempt.label === port.attempt)?.run;
      if (source) sources.set(source.taskId, source.workspace);
    }
    useCompareStore.getState().setCombine(comparisonId, {
      baseTaskId: winner.taskId,
      sources: [...sources].map(([taskId, workspace]) => ({ taskId, workspace })),
      draftedAt: new Date().toISOString(),
    });
  };
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
  const keep = async (winner: TaskRun, ports: CombinePort[] = []) => {
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
    if (ports.length) draftCombine(winner, ports);
    useExecutionStore.getState().select(winner.id);
    onClose();
    if (ports.length) requestAnimationFrame(() => document.getElementById('task-reply')?.focus());
  };
  return (
    <DialogContent className="task-comparison-dialog" aria-describedby="task-comparison-prompt">
      <DialogHeader title="Compare results" />
      <DialogCloseButton />
      <p id="task-comparison-prompt" className="task-comparison-prompt">
        {prompt}
      </p>
      {(finished.length >= 2 || judgeRun) && (
        <ComparisonJudge
          judgeRun={judgeRun}
          judgeName={judge ? name(judge.agent) : ''}
          verdict={verdict}
          loading={judgeLoading}
          attempts={attempts}
          canStart={finished.length >= 2 && !chosenTaskId}
          starting={judging}
          choice={{
            options: judgeOptions,
            value: judgeChoice?.id ?? '',
            independent: !!judgeChoice && isIndependentJudge(judgeChoice.adapter, authorAdapters),
            onChange: setJudgeAgent,
          }}
          selectedPorts={selectedPorts}
          onTogglePort={(index) =>
            setSkippedPorts((previous) => {
              const next = new Set(previous);
              if (!next.delete(index)) next.add(index);
              return next;
            })
          }
          onStart={() => void startJudge()}
          onOpen={(run) => {
            useExecutionStore.getState().select(run.id);
            onClose();
          }}
        />
      )}
      <div className="task-comparison-grid">
        {members.map((member) => {
          const stat = stats[member.id];
          const active = isActive(member);
          const label = labelFor(member.taskId);
          const ports = chosenTaskId ? [] : portsFor(member);
          return (
            <article
              key={member.id}
              className="task-comparison-card"
              data-kept={chosenTaskId === member.taskId || undefined}
            >
              <header>
                <AgentAvatar provider={adapter(member.agent)} size="sm" working={active} />
                <div>
                  <h3>
                    {label && <span className="task-comparison-label">{label} · </span>}
                    {name(member.agent)}
                  </h3>
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
                <Button disabled={busy || !isFinished(member)} onClick={() => void keep(member)}>
                  Keep this one
                </Button>
                {ports.length > 0 && (
                  <Button
                    variant="outline"
                    disabled={busy || !isFinished(member)}
                    onClick={() => void keep(member, ports)}
                  >
                    Keep and combine
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <DialogFooter>
        <p className="task-comparison-footnote">
          Keeping one archives the other finished attempts. Archived work, branches and worktrees
          stay available to restore. Keep and combine also drafts a follow-up on the kept attempt;
          it runs only when you send it.
        </p>
      </DialogFooter>
    </DialogContent>
  );
}
