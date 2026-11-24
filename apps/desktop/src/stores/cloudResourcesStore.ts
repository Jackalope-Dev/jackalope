import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CloudResourceKind } from '../lib/cloud-resources-plan';

/**
 * Choices on a project's Cloud resources screen, kept across Back, retry and reload
 * until setup succeeds. The Postgres connection string is a secret and is never kept here.
 */
export interface CloudResourcesDraft {
  kinds: CloudResourceKind[];
  prefix: string;
  domains: string;
}

interface CloudResourcesState {
  drafts: Record<string, CloudResourcesDraft>;
  saveDraft: (projectId: string, draft: CloudResourcesDraft) => void;
  clearDraft: (projectId: string) => void;
}

export const useCloudResourcesStore = create<CloudResourcesState>()(
  persist(
    (set) => ({
      drafts: {},
      saveDraft: (projectId, draft) =>
        set((state) => ({ drafts: { ...state.drafts, [projectId]: draft } })),
      clearDraft: (projectId) =>
        set((state) => {
          const { [projectId]: _cleared, ...drafts } = state.drafts;
          return { drafts };
        }),
    }),
    { name: 'jackalope-cloud-resources-v1' },
  ),
);
