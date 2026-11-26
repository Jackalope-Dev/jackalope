import { describeError } from '@jackalope/contracts/errors';
import { create } from 'zustand';
import {
  type RepositoryCandidate,
  recommendedPaths,
  scanForProjects,
} from '../lib/project-discovery.ts';

/**
 * The repositories first-run setup offers to add. Kept apart from the onboarding store: it
 * is not saved, and setup shows it only until the person adds some or skips it.
 */
interface ProjectDiscoveryState {
  status: 'idle' | 'scanning' | 'ready' | 'failed';
  candidates: RepositoryCandidate[];
  selected: string[];
  error: string | null;
  /** The person moved past the step, by adding repositories or skipping. */
  dismissed: boolean;
  scan: () => Promise<void>;
  toggle: (path: string, on: boolean) => void;
  /** Lists a folder the person picked themselves, chosen. */
  include: (candidate: RepositoryCandidate) => void;
  dismiss: () => void;
}

export const useProjectDiscoveryStore = create<ProjectDiscoveryState>((set, get) => ({
  status: 'idle',
  candidates: [],
  selected: [],
  error: null,
  dismissed: false,
  scan: async () => {
    if (get().status === 'scanning') return;
    set({ status: 'scanning', error: null });
    try {
      const scan = await scanForProjects();
      set({
        status: 'ready',
        candidates: scan.candidates,
        selected: [...recommendedPaths(scan.candidates)],
      });
    } catch (error) {
      set({ status: 'failed', error: describeError(error) });
    }
  },
  toggle: (path, on) =>
    set((state) => ({
      selected: on
        ? [...new Set([...state.selected, path])]
        : state.selected.filter((item) => item !== path),
    })),
  include: (candidate) =>
    set((state) => ({
      candidates: state.candidates.some((item) => item.path === candidate.path)
        ? state.candidates
        : [...state.candidates, candidate],
      selected: [...new Set([...state.selected, candidate.path])],
    })),
  dismiss: () => set({ dismissed: true }),
}));
