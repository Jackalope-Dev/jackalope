import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OnboardingStep = 'theme' | 'project' | 'agent' | 'task';
export type OnboardingStatus = 'new' | 'active' | 'complete' | 'skipped';

interface OnboardingState {
  status: OnboardingStatus;
  step: OnboardingStep;
  initialize: (hasProjects: boolean) => void;
  begin: () => void;
  go: (step: OnboardingStep) => void;
  finish: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      status: 'new',
      step: 'theme',
      initialize: (hasProjects) => {
        if (get().status === 'new')
          set({ status: hasProjects ? 'complete' : 'active', step: 'theme' });
      },
      begin: () => set({ status: 'active', step: 'theme' }),
      go: (step) => set({ step }),
      finish: () => set({ status: 'complete' }),
    }),
    { name: 'jackalope-onboarding-v1' },
  ),
);
