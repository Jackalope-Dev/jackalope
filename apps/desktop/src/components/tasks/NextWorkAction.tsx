import { useMemo } from 'react';
import { collectWorkspaceWork } from '../../lib/task-collection';
import type { TaskRun } from '../../lib/task-runtime';
import { taskDecision } from '../../lib/task-workflow';
import { attentionQueue } from '../../lib/workbench';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';

export function NextWorkAction({ run }: { run: TaskRun }) {
  const runs = useExecutionStore((state) => state.runs);
  const { sessions, runs: sessionRuns } = useLiveSessionStore();
  const queue = useManagedTaskStore((state) => state.queue);
  const next = useMemo(
    () =>
      attentionQueue(
        collectWorkspaceWork(
          null,
          [],
          [...new Map([...runs, ...sessionRuns].map((run) => [run.id, run])).values()],
          sessions,
          queue.mergedRunIds,
          false,
          queue,
        ),
      ).find(
        (item) => item.run?.taskId !== run.taskId && item.session?.id !== (run.liveSessionId ?? ''),
      ),
    [runs, sessionRuns, sessions, queue, run.taskId, run.liveSessionId],
  );
  if (!next) return null;
  return (
    <Button
      variant="outline"
      onClick={() => {
        const projectId =
          next.managed?.request.projectId ?? next.session?.request.projectId ?? next.run?.projectId;
        if (projectId) useProjectStore.getState().selectProject(projectId);
        useExecutionStore.getState().select(null);
        useManagedTaskStore.getState().select(next.managed?.id ?? null);
        if (next.managed) navigateWorkspace('kanban');
        else if (next.session) {
          useLiveSessionStore.getState().select(next.session.id);
          navigateWorkspace('live-sessions');
        } else if (next.run) {
          useExecutionStore.getState().select(next.run.id);
          useWorkViewStore.getState().open(next.run.id, taskDecision(next.run).section);
          navigateWorkspace('kanban');
        }
      }}
    >
      Next needs you · {next.title}
    </Button>
  );
}
