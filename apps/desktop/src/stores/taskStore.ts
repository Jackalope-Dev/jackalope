import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TaskStatus = 'backlog' | 'refinement' | 'in_progress' | 'verification' | 'done';

export interface TaskTicket {
  id: string;
  projectId: string;
  title: string;
  rawPrompt: string;
  refinedPrompt?: string;
  status: TaskStatus;
  worktreePath?: string;
  assignedAgent?: string;
  clarifications?: {
    question: string;
    answer?: string;
    suggestedOptions?: string[];
  }[];
  createdAt: string;
  updatedAt: string;
}

interface TaskState {
  tasks: TaskTicket[];
  activeModalTaskId: string | null;
  addTask: (task: Omit<TaskTicket, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, updates: Partial<TaskTicket>) => void;
  deleteTask: (id: string) => void;
  moveTaskStatus: (id: string, newStatus: TaskStatus) => void;
  openTaskModal: (id: string | null) => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set) => ({
  tasks: [
    {
      id: 'task-1',
      projectId: 'jackalope-core',
      title: 'Dynamic Palette OKLCH Color Engine',
      rawPrompt: 'Implement the Arc and Zen browser style color picker with custom accents',
      refinedPrompt: 'Add dynamic HSL/OKLCH color derivation with live CSS property injection into :root for surface-tinting, button focus glows, and contrast compliance.',
      status: 'done',
      assignedAgent: 'Agent Antigravity',
      worktreePath: '.worktrees/feat-color-engine',
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'task-2',
      projectId: 'jackalope-core',
      title: 'Proactive Intent Detection & Meta-Prompt Clarification',
      rawPrompt: 'Analyze user task tickets before running agent',
      refinedPrompt: 'Build heuristic analyzer that detects ambiguities in user feature requests, surfacing interactive multi-choice questions to refine requirements prior to worktree creation.',
      status: 'in_progress',
      assignedAgent: 'Agent Claude-3.7-Sonnet',
      worktreePath: '.worktrees/feat-auto-prompt',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date().toISOString(),
      clarifications: [
        {
          question: 'Should intent detection run automatically on paste or via explicit Refine button?',
          answer: 'Both: auto-detect on typing pause, explicit button for full review',
          suggestedOptions: ['Auto on pause', 'Explicit button only', 'Both'],
        },
      ],
    },
    {
      id: 'task-3',
      projectId: 'jackalope-core',
      title: 'Native PTY Streaming & Process Harness',
      rawPrompt: 'Run CLI agents with live terminal output in desktop window',
      refinedPrompt: 'Implement Tauri Rust backend command using portable-pty to multiplex streaming stdout/stderr with ANSI color escape code parsing for real-time agent monitoring.',
      status: 'refinement',
      assignedAgent: 'Unassigned',
      createdAt: new Date(Date.now() - 1800000).toISOString(),
      updatedAt: new Date().toISOString(),
      clarifications: [
        {
          question: 'Which terminal emulation renderer should be embedded?',
          suggestedOptions: ['xterm.js', 'Canvas minimal ANSI renderer', 'HTML stream pre block'],
        },
      ],
    },
    {
      id: 'task-4',
      projectId: 'jackalope-core',
      title: 'Scheduled Autonomous Maintenance Tasks',
      rawPrompt: 'Add cron schedules for agents to run nightly checks',
      refinedPrompt: 'Provide GUI scheduler enabling automated nightly dependency auditing, git branch stales, and automated PR reviews with notifications.',
      status: 'backlog',
      assignedAgent: 'Unassigned',
      createdAt: new Date(Date.now() - 900000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  activeModalTaskId: null,

  addTask: (taskData) => {
    const id = `task-${Date.now()}`;
    const newTask: TaskTicket = {
      ...taskData,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set((state) => ({ tasks: [newTask, ...state.tasks] }));
    return id;
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
      ),
    }));
  },

  deleteTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
      activeModalTaskId: state.activeModalTaskId === id ? null : state.activeModalTaskId,
    }));
  },

  moveTaskStatus: (id, newStatus) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t
      ),
    }));
  },

  openTaskModal: (id) => set({ activeModalTaskId: id }),
    }),
    {
      name: 'jackalope-tasks',
      partialize: (state) => ({ tasks: state.tasks }),
    }
  )
);
