import { Badge } from '@jackalope/ui';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { taskAgents } from '../../lib/agent-provider';
import { elapsedLabel, isActive, type TaskRun } from '../../lib/task-runtime';
import { taskDecision } from '../../lib/task-workflow';
import { AgentStack } from '../agents/AgentAvatar';
import { Button } from '../ui/button';
export function TaskProgress({
  run,
  integrated,
  pending,
  action,
  onActivity,
  verifyCommand,
}: {
  run: TaskRun;
  integrated: boolean;
  pending: number;
  action?: ReactNode;
  onActivity: () => void;
  verifyCommand?: string;
}) {
  const active = isActive(run);
  const progress = active ? run.progress : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!progress) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [progress]);
  const decision = taskDecision(run, integrated, verifyCommand);
  const agents = taskAgents(run);
  const presence = pending ? 'waiting' : active ? 'working' : 'idle';
  return (
    <section className="task-progress" aria-label="Task progress">
      <div className="task-progress-main">
        <div className="task-progress-art">
          <AgentStack agents={agents} state={presence} size="md" />
        </div>
        <div className="task-progress-identity">
          <div className="task-progress-status" role="status">
            <Badge appearance="plain" variant={decision.tone}>
              {decision.label}
            </Badge>
          </div>
          <p className="task-muted">
            {run.agent} · {run.accountBinding?.label || run.account}
            {agents.length > 1 ? ` · ${agents.length} agents on this task` : ''}
          </p>
          {!active && !integrated && (
            <p className="task-progress-next">
              {run.verification?.result.success && run.verification.tree
                ? decision.section === 'integrate'
                  ? `Checks passed. Review the change, merge into ${run.targetBranch || 'your project'}, then this workspace can be removed.`
                  : 'Checks passed for the recorded snapshot.'
                : run.verificationError || (run.verification && !run.verification.result.success)
                  ? 'Inspect the check output before accepting these changes.'
                  : decision.section === 'integrate'
                    ? `Review the change, merge into ${run.targetBranch || 'your project'}, then this workspace can be removed.`
                    : 'No passing project checks recorded.'}
            </p>
          )}
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
          <span className="task-progress-live-elapsed" aria-hidden="true">
            {elapsedLabel(progress.startedAt)}
          </span>
        </p>
      )}
      {active && !!run.activity.length && (
        <Button variant="ghost" className="task-progress-activity" onClick={onActivity}>
          <span>{run.activity.at(-1)?.trim().split('\n')[0] || 'View latest activity'}</span>
          <ArrowUpRight size={16} />
        </Button>
      )}
    </section>
  );
}
