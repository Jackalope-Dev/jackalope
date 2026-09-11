import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Badge } from '@jackalope/ui';
import { ArrowUpRight, Check, Circle, CircleAlert, LoaderCircle } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { elapsedLabel, isActive, type TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { RunStatus } from './RunStatus';

/** Re-render once a second so a running step's elapsed time stays honest. */
function useTicker(active: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

/** What the project setup command did, phrased for the step list. */
function setupDetail(run: TaskRun): string {
  const preparation = run.preparation;
  if (run.progress?.step === 'dependencies')
    return run.progress.attempt > 1 ? `Retrying (${run.progress.attempt})` : 'Running';
  if (!preparation) return run.status === 'starting' ? 'Waiting' : 'Not run';
  if (preparation.skipped) return 'Already current';
  if (!preparation.success) return 'Failed';
  return `Done in ${Math.max(1, Math.round(preparation.durationMs / 1000))}s`;
}

export function TaskProgress({
  run,
  integrated,
  pending,
  action,
  onActivity,
}: {
  run: TaskRun;
  integrated: boolean;
  pending: number;
  action?: ReactNode;
  onActivity: () => void;
}) {
  const active = isActive(run);
  const progress = active ? run.progress : null;
  useTicker(!!progress);
  const needsInput = pending > 0 && active && run.status !== 'stopping' && !run.finishing;
  const finished = ['review', 'reviewed'].includes(run.status);
  const blocked = ['failed', 'interrupted', 'stopped'].includes(run.status);
  const checked = !!run.verification?.result.success && !!run.verification.tree;
  const checksFailed = !!run.verificationError || (!!run.verification && !checked);
  const setupRan = !!run.preparation || !!run.prepareCommand;
  const steps = [
    {
      name: 'Workspace',
      detail:
        progress?.step === 'workspace'
          ? 'Preparing'
          : run.workspace
            ? run.branch || 'Recorded'
            : 'Not recorded',
      done: !!run.workspace && progress?.step !== 'workspace',
    },
    ...(setupRan
      ? [
          {
            name: 'Setup',
            detail: setupDetail(run),
            done: !!run.preparation?.success,
          },
        ]
      : []),
    {
      name: 'Agent',
      detail:
        run.finishing || finished
          ? 'Finished'
          : blocked
            ? 'Ended early'
            : needsInput
              ? 'Needs input'
              : run.status === 'stopping'
                ? 'Stopping'
                : run.status === 'running'
                  ? 'Working'
                  : progress?.step === 'routing'
                    ? 'Choosing agent'
                    : 'Waiting',
      done: finished || !!run.finishing,
    },
    {
      name: 'Review',
      detail: integrated
        ? 'Integrated'
        : run.status === 'reviewed'
          ? 'Reviewed'
          : finished
            ? 'Ready'
            : 'Pending',
      done: integrated || run.status === 'reviewed',
    },
  ];
  const next = run.finishing
    ? 'Running project checks'
    : needsInput
      ? 'Answer the question below to continue.'
      : run.status === 'interrupted'
        ? 'Inspect the session and workspace before starting more work.'
        : blocked
          ? 'Review the activity and any saved changes before continuing.'
          : finished
            ? integrated
              ? 'Changes integrated into the target branch.'
              : checksFailed
                ? 'Project checks need attention. See Review.'
                : checked
                  ? 'Project checks passed for the recorded snapshot.'
                  : 'No project checks recorded.'
            : run.status === 'stopping'
              ? 'Waiting for the agent to stop.'
              : '';
  return (
    <section className="task-progress" aria-label="Task progress">
      <div className="task-progress-main">
        <div className="task-progress-art" aria-hidden="true">
          <AgentCharacter
            provider={run.agent}
            state={
              run.status === 'running' && !run.finishing
                ? needsInput
                  ? 'waiting'
                  : 'working'
                : 'idle'
            }
          />
        </div>
        <div className="task-progress-identity">
          <div className="task-progress-status" role="status">
            {run.finishing ? (
              <Badge appearance="plain">Checking result</Badge>
            ) : integrated ? (
              <Badge appearance="plain" variant="success" icon={Check}>
                Integrated
              </Badge>
            ) : needsInput ? (
              <Badge appearance="plain" variant="warning" icon={CircleAlert}>
                Needs your input
              </Badge>
            ) : (
              <RunStatus status={run.status} progress={progress} />
            )}
          </div>
          <p className="task-muted">
            {run.agent} · {run.accountBinding?.label || run.account}
          </p>
          {next && <p className="task-progress-next">{next}</p>}
        </div>
        {action && <div className="task-progress-action">{action}</div>}
      </div>
      {progress && (
        <p className="task-progress-live" role="status">
          <LoaderCircle size={14} aria-hidden="true" />
          <span className="task-progress-live-step">
            {progress.label}
            {progress.attempt > 1 && ` · attempt ${progress.attempt}`}
          </span>
          {progress.detail && (
            <span className="task-progress-live-detail" title={progress.detail}>
              {progress.detail}
            </span>
          )}
          <span className="task-progress-live-elapsed">{elapsedLabel(progress.startedAt)}</span>
        </p>
      )}
      <ol className="task-progress-steps" data-count={steps.length} aria-label="Task stages">
        {steps.map((step) => (
          <li key={step.name} data-complete={step.done}>
            {step.done ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Circle size={16} aria-hidden="true" />
            )}
            <span>
              {step.name}
              <small>{step.detail}</small>
            </span>
          </li>
        ))}
      </ol>
      {active && !!run.activity.length && (
        <Button variant="ghost" className="task-progress-activity" onClick={onActivity}>
          <span>{run.activity.at(-1)?.trim().split('\n')[0] || 'View latest activity'}</span>
          <ArrowUpRight size={16} />
        </Button>
      )}
    </section>
  );
}
