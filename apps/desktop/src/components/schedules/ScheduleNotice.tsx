import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';

interface ScheduleStatus {
  definition: { id: string; name: string; request: { projectId: string } };
  history: { dueAt: string; runId: string | null; outcome: string }[];
}
export function ScheduleNotice() {
  const [schedules, setSchedules] = useState<ScheduleStatus[]>([]);
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
      nativeTask<{ schedules: ScheduleStatus[] }>('schedule_list')
        .then((data) => {
          if (active) setSchedules(data.schedules);
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const notices = schedules.flatMap((schedule) => {
    const event = schedule.history.at(-1);
    if (!event) return [];
    const run = runs.find((r) => r.id === event.runId);
    const status = run?.status ?? event.outcome;
    const actionable =
      ['review', 'failed', 'interrupted'].includes(status) ||
      status.startsWith('Failed') ||
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
  if (!notices.length) return null;
  return (
    <aside
      className="task-notice mx-6 mt-4"
      aria-label="Recurring task notifications"
      role="status"
    >
      {notices.slice(0, 3).map((notice) => (
        <div key={notice.key} className="flex flex-wrap items-center gap-3">
          <span>
            {notice.name}: {notice.status === 'review' ? 'ready to review' : notice.status}
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              useProjectStore.getState().selectProject(notice.projectId);
              navigateWorkspace('schedules');
            }}
          >
            View recurring tasks
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const next = [...dismissed, notice.key].slice(-300);
              setDismissed(next);
              try {
                localStorage.setItem('jackalope-schedule-notices', JSON.stringify(next));
              } catch {}
            }}
          >
            Dismiss
          </Button>
        </div>
      ))}
    </aside>
  );
}
