import { describeError } from '@jackalope/contracts/errors';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import {
  type ImportedConversation,
  type ImportProgress,
  listImportedConversations,
} from '../lib/imported-conversations';
import { isTauriEnvironment } from '../lib/native/env';
import { observeRefresh } from '../lib/observe-refresh';

interface ImportedConversationsState {
  conversations: ImportedConversation[];
  progress: ImportProgress | null;
  error: string | null;
  loaded: boolean;
  selectedId: string | null;
  refresh: () => Promise<void>;
  select: (id: string | null) => void;
}

export const useImportedConversationStore = create<ImportedConversationsState>((set, get) => ({
  conversations: [],
  progress: null,
  error: null,
  loaded: false,
  selectedId: null,
  select: (selectedId) => set({ selectedId }),
  refresh: async () => {
    try {
      const view = await listImportedConversations();
      const current = get();
      const same =
        current.loaded &&
        current.error === (view.error ?? null) &&
        JSON.stringify(current.progress) === JSON.stringify(view.progress) &&
        JSON.stringify(current.conversations) === JSON.stringify(view.conversations);
      if (!same)
        set({
          conversations: view.conversations,
          progress: view.progress,
          error: view.error ?? null,
          loaded: true,
        });
    } catch (error) {
      set({ error: describeError(error), loaded: true });
    }
  },
}));

/** Keeps imported conversations and import progress current; the native side announces changes. */
export function observeImportedConversations() {
  if (!isTauriEnvironment()) return;
  return observeRefresh({
    refresh: () => useImportedConversationStore.getState().refresh(),
    interval: () =>
      useImportedConversationStore.getState().progress?.running
        ? 2_000
        : document.hidden
          ? 300_000
          : 60_000,
    subscribe: (changed) => listen('imported-conversations-changed', changed),
  });
}
