import { Badge, Panel } from '@jackalope/ui';
import { ArrowRight, Play } from 'lucide-react';
import { nextAction, returnToProject } from '../../lib/project-return';
import type { TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import type { Project } from '../../stores/projectStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkViewStore } from '../../stores/workViewStore';
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
      <Panel className="p-6 text-center">
        <p className="font-semibold text-base mb-1">All caught up</p>
        <p className="task-muted text-sm mb-4">
          No active tasks in this project. Start a new task to build, fix, or explore.
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
        <Panel key={run.id} className="p-4 flex flex-wrap justify-between gap-3 items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <p className="font-medium text-base break-words">{taskTitle(run.prompt)}</p>
              <Badge variant={run.status === 'review' ? 'warning' : 'outline'}>
                {nextAction(run)}
              </Badge>
            </div>
            <p className="task-muted text-xs">Started {new Date(run.startedAt).toLocaleString()}</p>
          </div>
          <Button onClick={() => onOpen(run.id)}>Resume task</Button>
        </Panel>
      ))}
      {unfinished.length > 3 && (
        <div className="flex justify-between items-center pt-1">
          <p className="task-muted text-xs">
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
