import { Badge, Panel } from '@jackalope/ui';
import { ArrowRight, Play } from 'lucide-react';
import { nextAction, returnToProject } from '../../lib/project-return';
import type { TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import type { Project } from '../../stores/projectStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { AgentAvatar } from '../agents/AgentAvatar';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';

export function ProjectReturn({
  project,
  runs,
  integratedIds,
  onOpen,
}: {
  project: Project;
  runs: TaskRun[];
  integratedIds: string[];
  onOpen: (id: string) => void;
  expanded?: boolean;
}) {
  const unfinished = returnToProject(runs, project.id, integratedIds);

  if (!unfinished.length) {
    return (
      <Panel className="p-6 text-center rounded-xl">
        <p className="font-semibold text-base mb-1 text-[var(--color-text-primary)]">
          All caught up
        </p>
        <p className="text-[var(--color-text-secondary)] text-sm mb-4">
          No active tasks in this project. Your working tree is clean and ready.
        </p>
        <Button
          onClick={() => {
            useLiveSessionStore.getState().select(null);
            useProjectStore.getState().selectProject(project.id);
            navigateWorkspace('live-sessions');
          }}
        >
          <Play size={16} />
          Start new task
        </Button>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {unfinished.slice(0, 3).map((run) => (
        <Panel
          key={run.id}
          className="p-4 flex flex-wrap justify-between gap-3 items-center rounded-xl"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <AgentAvatar provider={run.agent} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <p className="font-medium text-base break-words text-[var(--color-text-primary)]">
                  {taskTitle(run.prompt)}
                </p>
                <Badge variant={run.status === 'review' ? 'warning' : 'outline'}>
                  {nextAction(run)}
                </Badge>
              </div>
              <p className="text-[var(--color-text-secondary)] text-xs">
                Started {new Date(run.startedAt).toLocaleString()} · {run.agent}
              </p>
            </div>
          </div>
          <Button onClick={() => onOpen(run.id)}>
            Resume task
            <ArrowRight size={14} className="ml-1" />
          </Button>
        </Panel>
      ))}
      {unfinished.length > 3 && (
        <div className="flex justify-between items-center pt-1">
          <p className="text-[var(--color-text-secondary)] text-xs">
            {unfinished.length - 3} more active task{unfinished.length - 3 > 1 ? 's' : ''} in your
            task backlog.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              useWorkViewStore.getState().setScope('project');
              navigateWorkspace('kanban');
            }}
          >
            View all in Tasks
            <ArrowRight size={14} className="ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
