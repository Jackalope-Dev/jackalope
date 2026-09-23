import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JevFallback } from '../lib/decisions';
import type { RoutingMode } from '../lib/routing-settings';
import type { Project } from './projectStore';

export type OnboardingStep = 'project' | 'agent' | 'routing' | 'behavior' | 'theme' | 'task';
export type OnboardingStatus = 'new' | 'active' | 'complete' | 'skipped';

interface OnboardingState {
  status: OnboardingStatus;
  step: OnboardingStep;
  projectId: string | null;
  pendingProject: Project | null;
  firstTask: string | null;
  routingMode: RoutingMode | null;
  routingFallback: JevFallback | null;
  setRoutingFallback: (fallback: JevFallback) => void;
  setRoutingMode: (mode: RoutingMode) => void;
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
      routingMode: null,
      routingFallback: null,
      setRoutingFallback: (routingFallback) => set({ routingFallback }),
      setRoutingMode: (routingMode) => set({ routingMode }),
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
          routingMode: null,
          routingFallback: null,
        }),
      selectProject: (projectId) =>
        set((state) => ({
          projectId,
          pendingProject: state.pendingProject?.id === projectId ? state.pendingProject : null,
          firstTask: state.projectId === projectId ? state.firstTask : null,
          routingMode: state.projectId === projectId ? state.routingMode : null,
          routingFallback: state.projectId === projectId ? state.routingFallback : null,
        })),
      stageProject: (project, firstTask) =>
        set((state) => ({
          projectId: project.id,
          pendingProject: project,
          firstTask: firstTask ?? (state.projectId === project.id ? state.firstTask : null),
          routingMode: state.projectId === project.id ? state.routingMode : null,
          routingFallback: state.projectId === project.id ? state.routingFallback : null,
        })),
      setFirstTask: (firstTask) => set({ firstTask }),
      go: (step) => set({ step }),
      finish: () =>
        set({
          status: 'complete',
          pendingProject: null,
          firstTask: null,
          projectId: null,
          routingMode: null,
          routingFallback: null,
        }),
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
          routingFallback:
            value.routingFallback === 'agent' || value.routingFallback === 'local'
              ? value.routingFallback
              : null,
          routingMode:
            value.routingMode === 'agent' ||
            value.routingMode === 'jev' ||
            value.routingMode === 'deterministic'
              ? value.routingMode
              : null,
          step:
            ((value.step !== 'theme' && value.step !== 'behavior') || value.pendingProject) &&
            ['project', 'agent', 'routing', 'behavior', 'theme', 'task'].includes(value.step ?? '')
              ? (value.step as OnboardingStep)
              : 'project',
        };
      },
    },
  ),
);
