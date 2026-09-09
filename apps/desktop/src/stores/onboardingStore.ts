import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OnboardingStep = 'project' | 'agent' | 'task';
export type OnboardingStatus = 'new' | 'active' | 'complete' | 'skipped';

interface OnboardingState {
  status: OnboardingStatus;
  step: OnboardingStep;
  projectId: string | null;
  initialize: (hasProjects: boolean) => void;
  begin: (projectId?: string) => void;
  selectProject: (projectId: string) => void;
  go: (step: OnboardingStep) => void;
  finish: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      status: 'new',
      step: 'project',
      projectId: null,
      initialize: (hasProjects) => {
        if (get().status === 'new')
          set({ status: hasProjects ? 'complete' : 'active', step: 'project' });
      },
      begin: (projectId) =>
        set({ status: 'active', step: 'project', projectId: projectId ?? null }),
      selectProject: (projectId) => set({ projectId }),
      go: (step) => set({ step }),
      finish: () => set({ status: 'complete' }),
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
          step: ['project', 'agent', 'task'].includes(value.step ?? '')
            ? (value.step as OnboardingStep)
            : 'project',
        };
      },
    },
  ),
);
