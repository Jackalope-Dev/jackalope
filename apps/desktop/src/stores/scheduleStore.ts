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
  runNow: (id: string) => Promise<void>;
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
  schedules: [
    {
      id: 'sched-1',
      name: 'Nightly Dependency & Security Audit',
      description: 'Runs audit tool, checks for CVEs, and drafts upgrade worktrees if patches exist.',
      cronExpression: '0 2 * * *',
      targetProjectId: 'jackalope-core',
      assignedAgentProvider: 'Agent Antigravity',
      prompt: 'Check all package.json and Cargo.lock dependencies for vulnerabilities and deprecated APIs.',
      enabled: true,
      lastRun: {
        timestamp: 'Yesterday at 02:00',
        status: 'success',
        durationSeconds: 42,
        summary: 'All 144 packages secure. 0 advisories found.',
      },
      nextRun: 'Tonight at 02:00',
    },
    {
      id: 'sched-2',
      name: 'Hourly Automated Test & Worktree Health',
      description: 'Executes typecheck and unit tests against active worktree branches to catch regressions.',
      cronExpression: '0 * * * *',
      targetProjectId: 'jackalope-core',
      assignedAgentProvider: 'Agent Claude-3.7-Sonnet',
      prompt: 'Run pnpm build and cargo check across active worktree directories.',
      enabled: true,
      lastRun: {
        timestamp: '38 minutes ago',
        status: 'success',
        durationSeconds: 16,
        summary: 'Clean compilation on main and feat/auto-prompt.',
      },
      nextRun: 'In 22 minutes',
    },
    {
      id: 'sched-3',
      name: 'Stale Worktree Auto-Prune',
      description: 'Identifies merged worktrees with no active processes and safely frees disk space.',
      cronExpression: '0 0 * * 0',
      targetProjectId: 'jackalope-core',
      assignedAgentProvider: 'Local Ollama',
      prompt: 'Inspect git worktree list and remove directories whose branches are merged into main.',
      enabled: false,
      nextRun: 'Sunday at 00:00',
    },
  ],

  toggleSchedule: (id) => {
    set((state) => ({
      schedules: state.schedules.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    }));
  },

  addSchedule: (sch) => {
    const id = `sched-${Date.now()}`;
    const newSchedule: ScheduledTask = {
      ...sch,
      id,
      nextRun: 'Scheduled according to cron',
    };
    set((state) => ({ schedules: [...state.schedules, newSchedule] }));
  },

  deleteSchedule: (id) => {
    set((state) => ({
      schedules: state.schedules.filter((s) => s.id !== id),
    }));
  },

  runNow: async (id) => {
    const target = get().schedules.find((s) => s.id === id);
    if (!target) return;

    set((state) => ({
      schedules: state.schedules.map((s) =>
        s.id === id
          ? {
              ...s,
              lastRun: {
                timestamp: 'Just now',
                status: 'running',
                durationSeconds: 0,
                summary: 'Task executing...',
              },
            }
          : s
      ),
    }));

    await new Promise((res) => setTimeout(res, 1800));

    set((state) => ({
      schedules: state.schedules.map((s) =>
        s.id === id
          ? {
              ...s,
              lastRun: {
                timestamp: 'Just now',
                status: 'success',
                durationSeconds: 4,
                summary: 'Manual trigger completed successfully. 0 regressions.',
              },
            }
          : s
      ),
    }));
  },
    }),
    {
      name: 'jackalope-schedules',
      partialize: (state) => ({ schedules: state.schedules }),
    }
  )
);
