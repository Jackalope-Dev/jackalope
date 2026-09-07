import { useEffect, useState } from 'react';
import { taskNotices } from '../../lib/companion-tasks';
import type { TaskRun } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { useProjectStore } from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { useCompanionNotices } from './useCompanionNotices';

export function openCompanionTask(run: TaskRun) {
  useProjectStore.getState().selectProject(run.projectId);
  useExecutionStore.getState().select(run.id);
  navigateWorkspace('kanban');
  requestAnimationFrame(() => document.getElementById('workspace-content')?.focus());
}

export function CompanionSources() {
  const runs = useExecutionStore((state) => state.runs);
  const error = useExecutionStore((state) => state.error);
  const message = useMascotStore((state) => state.message);
  const [latest, setLatest] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    if (message) setLatest({ id: `message:${crypto.randomUUID()}`, text: message });
  }, [message]);
  useCompanionNotices('tasks', taskNotices(runs, openCompanionTask));
  useCompanionNotices(
    'execution',
    error
      ? [
          {
            id: `execution:${error}`,
            title: 'Could not refresh task activity',
            detail: error,
            kind: 'attention',
            actionLabel: 'Open tasks',
            onOpen: () => navigateWorkspace('kanban'),
          },
        ]
      : [],
  );
  useCompanionNotices(
    'message',
    latest
      ? [
          {
            id: latest.id,
            title: 'A note from Jackalope',
            detail: latest.text,
            kind: 'info',
            onDismiss: () => setLatest(null),
          },
        ]
      : [],
  );
  return null;
}
