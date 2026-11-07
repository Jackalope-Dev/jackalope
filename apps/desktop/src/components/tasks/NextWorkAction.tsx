import { Button } from '@jackalope/ui';
import { useMemo } from 'react';
import type { TaskRun } from '../../lib/run-types';
import { taskDecision } from '../../lib/task-workflow';
import { showWork, useWorkspaceWork } from '../../lib/work-selection';
import { attentionQueue } from '../../lib/workbench';
import { navigateWorkspace } from '../layout/navigation';

export function NextWorkAction({ run }: { run: TaskRun }) {
  const work = useWorkspaceWork({ withoutDrafts: true });
  const next = useMemo(
    () =>
      attentionQueue(work).find(
        (item) => item.run?.taskId !== run.taskId && item.session?.id !== (run.liveSessionId ?? ''),
      ),
    [work, run.taskId, run.liveSessionId],
  );
  if (!next) return null;
  return (
    <Button
      variant="outline"
      onClick={() => {
        showWork(next, next.run && taskDecision(next.run).section);
        navigateWorkspace('kanban');
      }}
    >
      Next needs you · {next.title}
    </Button>
  );
}
