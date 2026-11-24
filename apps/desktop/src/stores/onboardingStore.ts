import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project } from './projectStore';

/** Routing, commit behavior and appearance use defaults and are edited later in project settings. */
export type OnboardingStep = 'project' | 'agent' | 'task';
type OnboardingStatus = 'new' | 'active' | 'complete' | 'skipped';
/** The one-time offer to import Claude Code and Codex history, made once setup finishes. */
type HistoryOffer = 'unseen' | 'due' | 'done';

interface OnboardingState {
  status: OnboardingStatus;
  step: OnboardingStep;
  projectId: string | null;
  pendingProject: Project | null;
  firstTask: string | null;
  historyOffer: HistoryOffer;
  initialize: (hasProjects: boolean) => void;
  begin: (projectId?: string) => void;
  selectProject: (projectId: string) => void;
  stageProject: (project: Project, firstTask?: string) => void;
  setFirstTask: (prompt: string) => void;
  go: (step: OnboardingStep) => void;
  finish: () => void;
  /** Leaves setup started from the workspace without adding the project. */
  cancel: () => void;
  /** The history offer was shown, or there was nothing to offer. */
  settleHistoryOffer: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      status: 'new',
      step: 'project',
      projectId: null,
      pendingProject: null,
      firstTask: null,
      historyOffer: 'unseen',
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
        set((state) => ({
          status: 'complete',
          pendingProject: null,
          firstTask: null,
          projectId: null,
          historyOffer: state.historyOffer === 'unseen' ? 'due' : state.historyOffer,
        })),
      cancel: () =>
        set({
          status: 'complete',
          step: 'project',
          pendingProject: null,
          firstTask: null,
          projectId: null,
        }),
      settleHistoryOffer: () => set({ historyOffer: 'done' }),
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
          historyOffer: ['unseen', 'due', 'done'].includes(value.historyOffer ?? '')
            ? (value.historyOffer as HistoryOffer)
            : 'unseen',
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
