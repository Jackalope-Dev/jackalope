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
  lastRun?: {
    timestamp: string;
    status: 'success' | 'failed' | 'running';
    durationSeconds: number;
    summary: string;
  };
  nextRun: string;
}

interface ScheduleState {
  schedules: ScheduledTask[];
  toggleSchedule: (id: string) => void;
  addSchedule: (schedule: Omit<ScheduledTask, 'id' | 'nextRun'>) => void;
  deleteSchedule: (id: string) => void;
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set) => ({
      schedules: [],

      toggleSchedule: (id) => {
        set((state) => ({
          schedules: state.schedules.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
        }));
      },

      addSchedule: (sch) => {
        const id = `sched-${Date.now()}`;
        const newSchedule: ScheduledTask = {
          ...sch,
          id,
          nextRun: 'Automatic execution unavailable',
        };
        set((state) => ({ schedules: [...state.schedules, newSchedule] }));
      },

      deleteSchedule: (id) => {
        set((state) => ({
          schedules: state.schedules.filter((s) => s.id !== id),
        }));
      },
    }),
    {
      name: 'jackalope-schedules',
      version: 1,
      migrate: (persisted) => ({
        schedules: ((persisted as { schedules?: ScheduledTask[] }).schedules ?? []).filter(
          (schedule) => !['sched-1', 'sched-2', 'sched-3'].includes(schedule.id),
        ),
      }),
      partialize: (state) => ({ schedules: state.schedules }),
    },
  ),
);
