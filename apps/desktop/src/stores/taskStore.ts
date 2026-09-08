import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ContextSelection } from '../lib/knowledge';
import type { TaskEffort } from '../lib/task-effort';

export type TaskStatus = 'backlog' | 'refinement' | 'in_progress' | 'verification' | 'done';

export interface TaskTicket {
  effort?: TaskEffort;
  model?: string;
  contextSelection?: ContextSelection;
  id: string;
  projectId: string;
  title: string;
  rawPrompt: string;
  refinedPrompt?: string;
  runId?: string;
  connectionIds?: string[];
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
  addTask: (task: Omit<TaskTicket, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, updates: Partial<TaskTicket>) => void;
  deleteTask: (id: string) => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set) => ({
      tasks: [],

      addTask: (taskData) => {
        const id = `task-${crypto.randomUUID()}`;
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
            t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t,
          ),
        }));
      },

      deleteTask: (id) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== id),
        }));
      },
    }),
    {
      name: 'jackalope-tasks',
      version: 1,
      migrate: (persisted) => ({
        tasks: ((persisted as { tasks?: TaskTicket[] }).tasks ?? []).filter(
          (task) => !(task.projectId === 'jackalope-core' && /^task-[1-4]$/.test(task.id)),
        ),
      }),
      partialize: (state) => ({ tasks: state.tasks }),
    },
  ),
);
