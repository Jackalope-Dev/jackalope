import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project } from './projectStore';

export type OnboardingStep = 'project' | 'agent' | 'theme' | 'task';
export type OnboardingStatus = 'new' | 'active' | 'complete' | 'skipped';

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
        set({ status: 'complete', pendingProject: null, firstTask: null, projectId: null }),
    }),
    {
      name: 'jackalope-onboarding-v1',
      merge: (saved, current) => {
        const value = (
          saved && typeof saved === 'object' ? saved : {}
        ) as Partial<OnboardingState> & { step?: string };
        return {
          ...current,
          ...value,
          pendingProject: value.pendingProject ?? null,
          firstTask: value.firstTask ?? null,
          step:
            (value.step !== 'theme' || value.pendingProject) &&
            ['project', 'agent', 'theme', 'task'].includes(value.step ?? '')
              ? (value.step as OnboardingStep)
              : 'project',
        };
      },
    },
  ),
);
