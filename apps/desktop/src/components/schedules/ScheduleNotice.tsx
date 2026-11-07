import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import { listSchedules, type SavedSchedule } from '../../lib/schedules';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { useCompanionNotices } from '../mascot/useCompanionNotices';

export function ScheduleNotice() {
  const [schedules, setSchedules] = useState<SavedSchedule[]>([]);
  const [error, setError] = useState('');
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
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let active = true;
    const refresh = () =>
      listSchedules()
        .then((data) => {
          if (active) {
            setSchedules(data.schedules);
            setError('');
          }
        })
        .catch((cause) => {
          if (active) setError(String(cause));
        });
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const notices = schedules.flatMap((schedule) => {
    const event = schedule.lastNotice ?? schedule.history.at(-1);
    if (!event) return [];
    const run = runs.find((r) => r.id === event.runId);
    if (run) return [];
    const status = event.outcome;
    const actionable =
      ['review', 'failed', 'interrupted'].includes(status) ||
      status.startsWith('Failed') ||
      status.startsWith('Change detected') ||
      status.startsWith('Monitor needs attention') ||
      status.startsWith('Interrupted dispatch');
    const key = `${schedule.definition.id}:${event.dueAt}:${status}`;
    return actionable && !dismissed.includes(key)
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
      detail: notice.status === 'review' ? 'Ready to review' : notice.status,
      kind: notice.status === 'review' ? 'success' : 'attention',
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
