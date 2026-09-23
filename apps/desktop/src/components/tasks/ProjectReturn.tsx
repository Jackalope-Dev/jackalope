import { Badge, Panel } from '@jackalope/ui';
import { ArrowRight, Play } from 'lucide-react';
import { projectTaskPresence } from '../../lib/project-return';
import type { QueueView } from '../../lib/queue';
import type { WorkItem } from '../../lib/task-collection';
import type { TaskRun } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import type { Project } from '../../stores/projectStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { AgentStack } from '../agents/AgentAvatar';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';

export function ProjectReturn({
  project,
  items,
  runs,
  queue,
  onOpen,
}: {
  project: Project;
  items: WorkItem[];
  runs: TaskRun[];
  queue: QueueView;
  onOpen: (item: WorkItem) => void;
}) {
  if (!items.length) {
    return (
      <Panel className="p-6 text-center rounded-xl">
        <p className="font-semibold text-base mb-1 text-[var(--color-text-primary)]">
          All caught up
        </p>
        <p className="text-[var(--color-text-secondary)] text-sm mb-4">
          No active tasks in this project.
        </p>
        <Button
          onClick={() => {
            useExecutionStore.getState().select(null);
            useManagedTaskStore.getState().select(null);
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
      {items.slice(0, 3).map((item) => {
        const presence = projectTaskPresence(item, runs, queue);
        return (
          <Panel
            key={item.id}
            className="p-4 flex flex-wrap justify-between gap-3 items-center rounded-xl"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <AgentStack agents={presence.agents} state={presence.state} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="font-medium text-base break-words text-[var(--color-text-primary)]">
                    {item.title}
                  </p>
                  <Badge variant={item.stage === 'attention' ? 'warning' : 'outline'}>
                    {presence.label}
                  </Badge>
                </div>
                <p className="text-[var(--color-text-secondary)] text-xs">
                  {new Date(item.date).toLocaleString()}
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={() => onOpen(item)}>
              {item.session ? 'Open chat' : 'Open task'}
              <ArrowRight size={14} className="ml-1" />
            </Button>
          </Panel>
        );
      })}
      {items.length > 3 && (
        <div className="flex justify-between items-center pt-1">
          <p className="text-[var(--color-text-secondary)] text-xs">
            {items.length - 3} more active task{items.length - 3 > 1 ? 's' : ''} in your task
            backlog.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              useExecutionStore.getState().select(null);
              useManagedTaskStore.getState().select(null);
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
