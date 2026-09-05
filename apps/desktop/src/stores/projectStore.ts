import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWorktree, listWorktrees, type WorktreeEntry } from '../lib/tauri-bridge';

export interface Project {
  id: string;
  name: string;
  path: string;
  gitBranch: string;
  worktrees: WorktreeEntry[];
  description?: string;
  agentProvider:
    | 'codex'
    | 'grok'
    | 'claude-code'
    | 'aider'
    | 'openhands'
    | 'ollama'
    | 'antigravity';
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  loading: boolean;
  addProject: (project: Omit<Project, 'worktrees'>) => Promise<void>;
  selectProject: (id: string) => void;
  loadWorktreesForActiveProject: () => Promise<void>;
  spawnTaskWorktree: (taskSlug: string, branchName: string) => Promise<WorktreeEntry | null>;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      loading: false,

      addProject: async (proj) => {
        const newProject: Project = { ...proj, worktrees: [] };
        set((state) => ({
          projects: [...state.projects, newProject],
          activeProjectId: newProject.id,
        }));
      },

      selectProject: (id: string) => {
        set({ activeProjectId: id });
        get().loadWorktreesForActiveProject();
      },

      loadWorktreesForActiveProject: async () => {
        const active = get().projects.find((p) => p.id === get().activeProjectId);
        if (!active) return;

        try {
          set({ loading: true });
          const worktrees = await listWorktrees(active.path);
          set((state) => ({
            projects: state.projects.map((p) => (p.id === active.id ? { ...p, worktrees } : p)),
          }));
        } catch (e) {
          console.warn('Failed to load worktrees', e);
        } finally {
          set({ loading: false });
        }
      },

      spawnTaskWorktree: async (taskSlug: string, branchName: string) => {
        const active = get().projects.find((p) => p.id === get().activeProjectId);
        if (!active) return null;

        try {
          const wtPath = `.worktrees/${taskSlug}`;
          const entry = await createWorktree(active.path, wtPath, branchName);
          await get().loadWorktreesForActiveProject();
          return entry;
        } catch (e) {
          console.error('Failed to spawn worktree', e);
          return null;
        }
      },
    }),
    {
      name: 'jackalope-projects',
      partialize: (state) => ({ projects: state.projects, activeProjectId: state.activeProjectId }),
    },
  ),
);
