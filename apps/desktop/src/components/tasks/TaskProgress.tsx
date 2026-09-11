import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Badge } from '@jackalope/ui';
import { ArrowUpRight, Check, Circle, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { isActive, type TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { RunStatus } from './RunStatus';
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
  const needsInput = pending > 0 && active && run.status !== 'stopping' && !run.finishing;
  const finished = ['review', 'reviewed'].includes(run.status);
  const blocked = ['failed', 'interrupted', 'stopped'].includes(run.status);
  const checked = !!run.verification?.result.success && !!run.verification.tree;
  const checksFailed = !!run.verificationError || (!!run.verification && !checked);
  const steps = [
    {
      name: 'Workspace',
      detail: run.status === 'starting' ? 'Preparing' : run.workspace ? 'Recorded' : 'Not recorded',
      done: !!run.workspace && run.status !== 'starting',
    },
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
            : run.status === 'starting'
              ? 'Preparing the workspace and agent session.'
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
              <RunStatus status={run.status} />
            )}
          </div>
          <p className="task-muted">
            {run.agent} · {run.accountBinding?.label || run.account}
          </p>
          {next && <p className="task-progress-next">{next}</p>}
        </div>
        {action && <div className="task-progress-action">{action}</div>}
      </div>
      <ol className="task-progress-steps" aria-label="Task stages">
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
