import { Badge } from '@jackalope/ui';
import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { taskAgents } from '../../lib/agent-provider';
import { isActive, type TaskRun } from '../../lib/task-runtime';
import { taskDecision } from '../../lib/task-workflow';
import { AgentStack } from '../agents/AgentAvatar';
import { Button } from '../ui/button';
import { TaskLiveActivity } from './TaskLiveActivity';
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
        </div>
        {action && <div className="task-progress-action">{action}</div>}
      </div>
      <TaskLiveActivity run={run} />
      {active && !!run.activity.length && (
        <Button variant="outline" className="task-progress-activity" onClick={onActivity}>
          <span>View activity</span>
          <ArrowUpRight size={16} />
        </Button>
      )}
    </section>
  );
}
