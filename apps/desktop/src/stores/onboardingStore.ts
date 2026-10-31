import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project } from './projectStore';

/** Routing, commit behavior and appearance use defaults and are edited later in project settings. */
export type OnboardingStep = 'project' | 'agent' | 'task';
type OnboardingStatus = 'new' | 'active' | 'complete' | 'skipped';

interface OnboardingState {
  status: OnboardingStatus;
  step: OnboardingStep;
  projectId: string | null;
  pendingProject: Project | null;
  firstTask: string | null;
  initialize: (hasProjects: boolean) => void;
  begin: (projectId?: string) => void;
  selectProject: (projectId: string) => void;
  stageProject: (project: Project, firstTask?: string) => void;
  setFirstTask: (prompt: string) => void;
  go: (step: OnboardingStep) => void;
  finish: () => void;
  /** Leaves setup started from the workspace without adding the project. */
  cancel: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      status: 'new',
      step: 'project',
      projectId: null,
      pendingProject: null,
      firstTask: null,
      initialize: (hasProjects) => {
        if (get().status === 'new')
          set({ status: hasProjects ? 'complete' : 'active', step: 'project' });
      },
      begin: (projectId) =>
        set({
          status: 'active',
          step: 'project',
          projectId: projectId ?? null,
          pendingProject: null,
          firstTask: null,
        }),
      selectProject: (projectId) =>
        set((state) => ({
          projectId,
          pendingProject: state.pendingProject?.id === projectId ? state.pendingProject : null,
          firstTask: state.projectId === projectId ? state.firstTask : null,
        })),
      stageProject: (project, firstTask) =>
        set((state) => ({
          projectId: project.id,
          pendingProject: project,
          firstTask: firstTask ?? (state.projectId === project.id ? state.firstTask : null),
        })),
      setFirstTask: (firstTask) => set({ firstTask }),
      go: (step) => set({ step }),
      finish: () =>
        set({
          status: 'complete',
          pendingProject: null,
          firstTask: null,
          projectId: null,
        }),
      cancel: () =>
        set({
          status: 'complete',
          step: 'project',
          pendingProject: null,
          firstTask: null,
          projectId: null,
        }),
    }),
    {
      name: 'jackalope-onboarding-v1',
      merge: (saved, current) => {
        const value = (
          saved && typeof saved === 'object' ? saved : {}
        ) as Partial<OnboardingState> & { step?: string };
        const {
          routingMode: _mode,
          routingFallback: _fallback,
          ...kept
        } = value as typeof value & {
          routingMode?: unknown;
          routingFallback?: unknown;
        };
        // Earlier setups had decision, behavior and appearance steps between agents and the
        // first task; a staged project resumes at the first task, otherwise setup restarts.
        const legacy = ['routing', 'behavior', 'theme'].includes(value.step ?? '');
        return {
          ...current,
          ...kept,
          pendingProject: value.pendingProject ?? null,
          firstTask: value.firstTask ?? null,
          step: legacy
            ? value.pendingProject
              ? 'task'
              : 'project'
            : ['project', 'agent', 'task'].includes(value.step ?? '')
              ? (value.step as OnboardingStep)
              : 'project',
        };
      },
    },
  ),
);
