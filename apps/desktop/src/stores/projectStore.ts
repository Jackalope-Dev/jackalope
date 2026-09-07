import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWorktree, listWorktrees, type WorktreeEntry } from '../lib/tauri-bridge.ts';

export interface ProjectPreferences {
  preferredRunner?: string;
  /**
   * Undefined allows every app-enabled agent. An explicit list restricts tasks
   * to those agent IDs; an empty list blocks launches.
   */
  allowedAgents?: string[];
  /**
   * Which configured account (agent-profile id) this project's tasks use for
   * a given agent, keyed by agent id ("codex"/"claude"/"grok"). Missing an
   * entry means "whichever account is globally active for that agent" — the
   * unchanged default for every project that hasn't picked one.
   */
  agentAccounts?: Record<string, string>;
  customInstructions?: string;
  baseBranch?: string;
  branchPrefix?: string;
  worktreeDir?: string;
  verifyCommand?: string;
  prepareCommand?: string;
  autoVerify?: boolean;
  isolatedByDefault?: boolean;
}

/**
 * Whether `agentId` may be used for tasks in `project`, per its allow-list preference.
 * `allowedAgents` left unset means unrestricted (every app-enabled agent is allowed).
 * An explicit list — including an empty one — restricts tasks to exactly those agents,
 * matching the existing "empty restricted model list blocks launches" convention.
 */
export function isAgentAllowedForProject(
  project: Pick<Project, 'preferences'> | undefined,
  agentId: string,
): boolean {
  const allowed = project?.preferences?.allowedAgents;
  return allowed === undefined || allowed.includes(agentId);
}

/** The account (agent-profile id) `project` wants for `agentId`, or undefined for the global default. */
export function agentAccountFor(
  project: Pick<Project, 'preferences'> | undefined,
  agentId: string,
): string | undefined {
  return project?.preferences?.agentAccounts?.[agentId];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  gitBranch: string;
  worktrees: WorktreeEntry[];
  description?: string;
  preferences?: ProjectPreferences;
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
  worktreesError: string | null;
  addProject: (project: Omit<Project, 'worktrees'>) => Promise<void>;
  updateProject: (id: string, partial: Partial<Omit<Project, 'id' | 'worktrees'>>) => void;
  updateProjectPreferences: (id: string, prefs: Partial<ProjectPreferences>) => void;
  removeProject: (id: string) => void;
  selectProject: (id: string) => void;
  loadWorktreesForActiveProject: (targetBranch?: string) => Promise<void>;
  spawnTaskWorktree: (
    taskSlug: string,
    branchName: string,
  ) => Promise<{ ok: true; entry: WorktreeEntry } | { ok: false; error: string }>;
}

let worktreeRequest = 0;

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      loading: false,
      worktreesError: null,

      addProject: async (proj) => {
        const newProject: Project = { ...proj, worktrees: [] };
        set((state) => ({
          projects: [...state.projects, newProject],
          activeProjectId: newProject.id,
        }));
      },

      updateProject: (id, partial) => {
        set((state) => ({
          projects: state.projects.map((p) => (p.id === id ? { ...p, ...partial } : p)),
        }));
      },

      updateProjectPreferences: (id, prefs) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, preferences: { ...(p.preferences ?? {}), ...prefs } } : p,
          ),
        }));
      },

      removeProject: (id) => {
        set((state) => {
          const nextProjects = state.projects.filter((p) => p.id !== id);
          const nextActive =
            state.activeProjectId === id ? (nextProjects[0]?.id ?? null) : state.activeProjectId;
          return { projects: nextProjects, activeProjectId: nextActive };
        });
      },

      selectProject: (id: string) => {
        set({ activeProjectId: id, worktreesError: null });
        get().loadWorktreesForActiveProject();
      },

      loadWorktreesForActiveProject: async (targetBranch) => {
        const active = get().projects.find((p) => p.id === get().activeProjectId);
        if (!active) return;
        const request = ++worktreeRequest;

        try {
          set({ loading: true, worktreesError: null });
          const worktrees = await listWorktrees(active.path, targetBranch);
          if (request !== worktreeRequest || get().activeProjectId !== active.id) return;
          set((state) => ({
            projects: state.projects.map((p) => (p.id === active.id ? { ...p, worktrees } : p)),
          }));
        } catch (e) {
          if (request === worktreeRequest && get().activeProjectId === active.id) {
            set((state) => ({
              worktreesError: e instanceof Error ? e.message : String(e),
              projects: state.projects.map((p) =>
                p.id === active.id ? { ...p, worktrees: [] } : p,
              ),
            }));
          }
        } finally {
          if (request === worktreeRequest) set({ loading: false });
        }
      },

      spawnTaskWorktree: async (taskSlug: string, branchName: string) => {
        const active = get().projects.find((p) => p.id === get().activeProjectId);
        if (!active) return { ok: false, error: 'No active project selected.' };

        try {
          const wtPath = `.worktrees/${taskSlug}`;
          const entry = await createWorktree(active.path, wtPath, branchName);
          await get().loadWorktreesForActiveProject();
          return { ok: true, entry };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          console.error('Failed to spawn worktree', e);
          return { ok: false, error };
        }
      },
    }),
    {
      name: 'jackalope-projects',
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { projects?: Project[]; activeProjectId?: string | null };
        return {
          projects: (state.projects ?? []).map((project) => ({ ...project, worktrees: [] })),
          activeProjectId: state.activeProjectId ?? null,
        };
      },
      partialize: (state) => ({
        projects: state.projects.map((project) => ({ ...project, worktrees: [] })),
        activeProjectId: state.activeProjectId,
      }),
    },
  ),
);
