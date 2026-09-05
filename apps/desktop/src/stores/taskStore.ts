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
      tasks: [],
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
            t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t,
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
            t.id === id ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t,
          ),
        }));
      },

      openTaskModal: (id) => set({ activeModalTaskId: id }),
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
