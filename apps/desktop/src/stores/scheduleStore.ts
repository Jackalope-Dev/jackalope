import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  targetProjectId: string;
  assignedAgentProvider: string;
  prompt: string;
  enabled: boolean;
  importId?: string;
}

interface ScheduleState {
  schedules: ScheduledTask[];
  prepareImport: (id: string) => string;
  deleteSchedule: (id: string) => void;
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
      schedules: [],
      prepareImport: (id) => {
        const plan = get().schedules.find((schedule) => schedule.id === id);
        if (!plan) throw new Error('This saved plan is no longer available.');
        const importId = plan.importId ?? crypto.randomUUID();
        // Persist the destination before saving natively so retries reuse the same schedule.
        set({
          schedules: get().schedules.map((schedule) =>
            schedule.id === id ? { ...schedule, importId } : schedule,
          ),
        });
        return importId;
      },
      deleteSchedule: (id) =>
        set((state) => ({ schedules: state.schedules.filter((schedule) => schedule.id !== id) })),
    }),
    {
      name: 'jackalope-schedules',
      version: 3,
      migrate: (persisted) => ({
        schedules: (
          (
            persisted as {
              schedules?: (ScheduledTask & { lastRun?: unknown; nextRun?: unknown })[];
            }
          ).schedules ?? []
        )
          .filter((schedule) => !['sched-1', 'sched-2', 'sched-3'].includes(schedule.id))
          .map(({ lastRun: _lastRun, nextRun: _nextRun, ...schedule }) => schedule),
      }),
      partialize: (state) => ({ schedules: state.schedules }),
    },
  ),
);
