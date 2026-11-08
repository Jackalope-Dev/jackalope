import { useState } from 'react';
import { navigateWorkspace } from '../../lib/app-events';
import { isTauriEnvironment } from '../../lib/native/env';
import { listSchedules, needsAction } from '../../lib/schedules';
import { useNativeResource } from '../../lib/useNativeResource';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useCompanionNotices } from '../mascot/useCompanionNotices';

export function ScheduleNotice() {
  const desktop = isTauriEnvironment();
  const { data, error } = useNativeResource(listSchedules, [], { pollMs: 15000, enabled: desktop });
  const schedules = data?.schedules ?? [];
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('jackalope-schedule-notices') ?? '[]');
      return Array.isArray(saved)
        ? saved.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  });
  const runs = useExecutionStore((s) => s.runs);
  const notices = schedules.flatMap((schedule) => {
    const event = schedule.lastNotice ?? schedule.history.at(-1);
    if (!event) return [];
    const run = runs.find((r) => r.id === event.runId);
    if (run) return [];
    const status = event.outcome;
    const key = `${schedule.definition.id}:${event.dueAt}:${status}`;
    return needsAction(event) && !dismissed.includes(key)
      ? [
          {
            key,
            name: schedule.definition.name,
            projectId: schedule.definition.request.projectId,
            status,
          },
        ]
      : [];
  });
  useCompanionNotices(
    'schedules',
    notices.map((notice) => ({
      id: `schedule:${notice.key}`,
      title: notice.name,
      detail: notice.status,
      kind: 'attention',
      actionLabel: 'Open schedule',
      onOpen: () => {
        useProjectStore.getState().selectProject(notice.projectId);
        navigateWorkspace('schedules');
      },
      onDismiss: () => {
        const next = [...dismissed, notice.key].slice(-300);
        setDismissed(next);
        try {
          localStorage.setItem('jackalope-schedule-notices', JSON.stringify(next));
        } catch {}
      },
    })),
  );
  useCompanionNotices(
    'schedule-error',
    error
      ? [
          {
            id: 'schedule-refresh-error',
            title: 'Could not check schedules',
            detail: error,
            kind: 'attention',
            actionLabel: 'Open schedules',
            onOpen: () => navigateWorkspace('schedules'),
          },
        ]
      : [],
  );
  return null;
}
