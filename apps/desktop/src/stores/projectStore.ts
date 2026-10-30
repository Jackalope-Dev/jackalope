import type { ThemePalette } from '@jackalope/brand/theme';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type FeatureMapEntry, featureMapForRegistry } from '../lib/feature-map.ts';
import { reviewPagesForRegistry } from '../lib/review-captures.ts';
import { nativeTask } from '../lib/task-runtime.ts';
import { createWorktree, isTauriEnvironment, type WorktreeEntry } from '../lib/tauri-bridge.ts';
import { WORKSPACE_MODES, type WorkspaceMode } from '../lib/workspace-mode.ts';
import { readWorktrees } from '../lib/worktree-reads.ts';

export interface ProjectPreferences {
  preferredRunner?: string;
  theme?: ThemePalette;
  disabledAccounts?: Record<string, string[]>;
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
  automaticTaskContext?: boolean;
  /** Split substantial requests into subtasks without a plan review. Defaults to on. */
  automaticSubtasks?: boolean;
  taskGuidelines?: string[];
  baseBranch?: string;
  branchPrefix?: string;
  worktreeDir?: string;
  verifyCommand?: string;
  previewCommand?: string;
  prepareCommand?: string;
  setupFiles?: string[];
  autoVerify?: boolean;
  /** Superseded by `workspaceMode`; `false` still means current-branch work. */
  isolatedByDefault?: boolean;
  /** Undefined means an isolated worktree, or `isolatedByDefault` when that is set. */
  workspaceMode?: WorkspaceMode;
  /**
   * Approve routine agent requests without asking and escalate only high-risk
   * ones. Undefined means on.
   */
  autoApprove?: boolean;
  /** Reflect on work in the background and tidy learned lessons. Undefined means on. */
  learnAutomatically?: boolean;
  /** Reported tool calls between background reflections. Undefined means 50. */
  learningCadence?: number;
  /** Include learned lessons in account lesson sync when it is on. Undefined means included. */
  syncLessons?: boolean;
  /** Also reflect on finished work with the default agent, using its quota. Undefined means off. */
  agentReflection?: boolean;
  /** Mirror active learned lessons into AGENTS.md and a Claude Code skill. Undefined means off. */
  exportLessons?: boolean;
  /**
   * Load the person's own Claude Code settings, plugins, hooks and MCP servers in Claude
   * Code tasks. `false` limits them to project settings and Jackalope's connections.
   */
  personalClaudeSetup?: boolean;
  /** Fast command Claude Code runs after each file edit; `{file}` is the edited path. */
  editCheck?: string;
  /** Before/after screenshots of finished work from the preview command. Undefined means on. */
  reviewCaptures?: boolean;
  /** Preview paths always captured for review, one per entry. Empty means `/`. */
  reviewPages?: string[];
  /** Screenshot sizes. Undefined means desktop only. */
  reviewViewports?: ('desktop' | 'narrow')[];
  /** User-facing features whose pages review screenshots prefer when their sources change. */
  featureMap?: FeatureMapEntry[];
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
  /** Not a Git repository: tasks run in the folder itself, without branches or worktrees. */
  plainFolder?: boolean;
  worktrees: WorktreeEntry[];
  description?: string;
  preferences?: ProjectPreferences;
  agentProvider: 'codex' | 'grok' | 'claude-code' | 'openhands' | 'ollama' | 'antigravity';
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  loading: boolean;
  checkingWorktrees: boolean;
  worktreesError: string | null;
  addProject: (project: Omit<Project, 'worktrees'>) => Promise<void>;
  completeSetup: (project: Project) => Project;
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

export function projectPathKey(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/\/$/, '');
  return typeof navigator !== 'undefined' && navigator.platform.includes('Win')
    ? normalized.toLowerCase()
    : normalized;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      loading: false,
      checkingWorktrees: false,
      worktreesError: null,

      addProject: async (proj) => {
        const newProject: Project = { ...proj, worktrees: [] };
        set((state) => ({
          projects: [...state.projects, newProject],
          activeProjectId: newProject.id,
        }));
      },

      completeSetup: (pending) => {
        const existing = get().projects.find(
          (project) =>
            project.id === pending.id ||
            projectPathKey(project.path) === projectPathKey(pending.path),
        );
        const project = existing
          ? {
              ...existing,
              preferences: {
                ...existing.preferences,
                preferredRunner: pending.preferences?.preferredRunner,
                allowedAgents: pending.preferences?.allowedAgents,
                theme: pending.preferences?.theme,
              },
            }
          : pending;
        set((state) => ({
          projects: existing
            ? state.projects.map((item) => (item.id === project.id ? project : item))
            : [...state.projects, project],
          activeProjectId: project.id,
          worktreesError: null,
        }));
        return project;
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
        const removingActive = get().activeProjectId === id;
        if (removingActive) worktreeRequest++;
        set((state) => {
          const nextProjects = state.projects.filter((p) => p.id !== id);
          const nextActive =
            state.activeProjectId === id ? (nextProjects[0]?.id ?? null) : state.activeProjectId;
          return {
            projects: nextProjects,
            activeProjectId: nextActive,
            ...(removingActive
              ? { loading: false, checkingWorktrees: false, worktreesError: null }
              : {}),
          };
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
        if (active.plainFolder) {
          set({ loading: false, checkingWorktrees: false, worktreesError: null });
          return;
        }

        try {
          set({ loading: true, checkingWorktrees: false, worktreesError: null });
          const worktrees = await readWorktrees(active.path, targetBranch, false);
          if (request !== worktreeRequest || get().activeProjectId !== active.id) return;
          const normActive = active.path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
          const matchingWt =
            worktrees.find(
              (wt) =>
                wt.path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() === normActive,
            ) ?? worktrees[0];
          const currentBranch = matchingWt?.branch?.trim();
          set((state) => ({
            loading: false,
            checkingWorktrees: true,
            projects: state.projects.map((p) =>
              p.id === active.id
                ? { ...p, worktrees, ...(currentBranch ? { gitBranch: currentBranch } : {}) }
                : p,
            ),
          }));
          const inspected = await readWorktrees(active.path, targetBranch, true);
          if (request !== worktreeRequest || get().activeProjectId !== active.id) return;
          const matchingInspected =
            inspected.find(
              (wt) =>
                wt.path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() === normActive,
            ) ?? inspected[0];
          const inspectedBranch = matchingInspected?.branch?.trim();
          set((state) => ({
            projects: state.projects.map((p) =>
              p.id === active.id
                ? {
                    ...p,
                    worktrees: inspected,
                    ...(inspectedBranch ? { gitBranch: inspectedBranch } : {}),
                  }
                : p,
            ),
          }));
        } catch (e) {
          if (request === worktreeRequest && get().activeProjectId === active.id) {
            set({
              worktreesError: e instanceof Error ? e.message : String(e),
            });
          }
        } finally {
          if (request === worktreeRequest) set({ loading: false, checkingWorktrees: false });
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
      onRehydrateStorage: () => (state) => {
        if (state) void mergeProjectRegistry();
      },
    },
  ),
);

interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  /** The accent the project shows in, so the terminal can match it. */
  accent?: string;
  autoApprove?: boolean;
  workspaceMode?: WorkspaceMode;
  learnAutomatically?: boolean;
  learningCadence?: number;
  syncLessons?: boolean;
  agentReflection?: boolean;
  exportLessons?: boolean;
  personalClaudeSetup?: boolean;
  editCheck?: string;
  /** Mirrored one way so a terminal approving a plan uses the app's check. */
  verifyCommand?: string;
  autoVerify?: boolean;
  prepareCommand?: string;
  setupFiles?: string[];
  previewCommand?: string;
  reviewCaptures?: boolean;
  reviewPages?: string[];
  reviewViewports?: string[];
  featureMap?: FeatureMapEntry[];
}

/**
 * The app-wide accent, used for projects without a theme of their own. Set by
 * the theme store, which imports this one, so it is pushed rather than read.
 */
let appAccent: string | undefined;

export function setRegistryAppAccent(accent: string) {
  if (accent === appAccent) return;
  appAccent = accent;
  mirrorProjects(useProjectStore.getState().projects);
}

function projectRecords(projects: Project[]): ProjectRecord[] {
  return projects.map(({ id, name, path, preferences }) => ({
    id,
    name,
    path,
    accent: preferences?.theme?.accentHex ?? appAccent,
    autoApprove: preferences?.autoApprove,
    workspaceMode: preferences?.workspaceMode,
    learnAutomatically: preferences?.learnAutomatically,
    learningCadence: preferences?.learningCadence,
    syncLessons: preferences?.syncLessons,
    agentReflection: preferences?.agentReflection,
    exportLessons: preferences?.exportLessons,
    personalClaudeSetup: preferences?.personalClaudeSetup,
    editCheck: preferences?.editCheck,
    verifyCommand: preferences?.verifyCommand?.trim() || undefined,
    autoVerify: preferences?.autoVerify,
    prepareCommand: preferences?.prepareCommand?.trim() || undefined,
    setupFiles: preferences?.setupFiles?.length ? preferences.setupFiles : undefined,
    previewCommand: preferences?.previewCommand?.trim() || undefined,
    reviewCaptures: preferences?.reviewCaptures,
    reviewPages: reviewPagesForRegistry(preferences?.reviewPages),
    reviewViewports: preferences?.reviewViewports?.length ? preferences.reviewViewports : undefined,
    featureMap: featureMapForRegistry(preferences?.featureMap),
  }));
}

// Adopts repositories registered from a terminal, on load and whenever a
// terminal registers one while this window is open, then republishes so the mirror reflects any projects added while it was
// unavailable.
export async function mergeProjectRegistry() {
  if (!isTauriEnvironment()) return;
  try {
    const records = await nativeTask<ProjectRecord[]>('project_registry_list', {});
    const state = useProjectStore.getState();
    const known = new Set(state.projects.map((project) => projectPathKey(project.path)));
    const added = records
      .filter((record) => !known.has(projectPathKey(record.path)))
      .map<Project>((record) => ({
        id: record.id,
        name: record.name,
        path: record.path,
        gitBranch: '',
        worktrees: [],
        agentProvider: 'codex',
      }));
    if (added.length) {
      useProjectStore.setState((current) => ({ projects: [...current.projects, ...added] }));
    }
    // A terminal can change these settings while the app is closed or headless.
    for (const record of records) {
      const project = useProjectStore
        .getState()
        .projects.find((item) => projectPathKey(item.path) === projectPathKey(record.path));
      if (!project) continue;
      const changes: Partial<ProjectPreferences> = {};
      if (
        record.autoApprove !== undefined &&
        record.autoApprove !== project.preferences?.autoApprove
      )
        changes.autoApprove = record.autoApprove;
      if (
        record.workspaceMode &&
        WORKSPACE_MODES.includes(record.workspaceMode) &&
        record.workspaceMode !== project.preferences?.workspaceMode
      )
        changes.workspaceMode = record.workspaceMode;
      if (
        record.learnAutomatically !== undefined &&
        record.learnAutomatically !== project.preferences?.learnAutomatically
      )
        changes.learnAutomatically = record.learnAutomatically;
      if (
        record.learningCadence !== undefined &&
        record.learningCadence !== project.preferences?.learningCadence
      )
        changes.learningCadence = record.learningCadence;
      for (const key of ['syncLessons', 'agentReflection', 'exportLessons'] as const) {
        if (record[key] !== undefined && record[key] !== project.preferences?.[key])
          changes[key] = record[key];
      }
      if (
        record.personalClaudeSetup !== undefined &&
        record.personalClaudeSetup !== project.preferences?.personalClaudeSetup
      )
        changes.personalClaudeSetup = record.personalClaudeSetup;
      if (record.editCheck !== undefined && record.editCheck !== project.preferences?.editCheck)
        changes.editCheck = record.editCheck;
      if (
        record.reviewCaptures !== undefined &&
        record.reviewCaptures !== project.preferences?.reviewCaptures
      )
        changes.reviewCaptures = record.reviewCaptures;
      if (Object.keys(changes).length)
        useProjectStore.getState().updateProjectPreferences(project.id, changes);
    }
    mirrorProjects(useProjectStore.getState().projects);
  } catch {
    // Nothing to adopt if the host cannot be reached.
  }
}

let mirrored: string | null = null;
let requestedMirror: string | null = null;
let mirrorSync: Promise<void> = Promise.resolve();
function mirrorProjects(projects: Project[]) {
  if (!isTauriEnvironment()) return;
  const records = projectRecords(projects);
  const encoded = JSON.stringify(records);
  if (encoded === requestedMirror) return;
  requestedMirror = encoded;
  mirrorSync = mirrorSync
    .then(async () => {
      if (encoded === mirrored) return;
      await nativeTask('project_registry_save', { projects: records });
      mirrored = encoded;
    })
    .catch(() => {
      // Retry the same snapshot on the next update if the host was unavailable.
      if (requestedMirror === encoded) requestedMirror = null;
    });
}
// Subscribing rather than writing from each mutator means a future action
// cannot forget to mirror.
useProjectStore.subscribe((state) => mirrorProjects(state.projects));
