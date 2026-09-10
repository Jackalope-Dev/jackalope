import { create } from 'zustand';

export interface TodoDraft {
  base: string | null;
  content: string;
}

// Keep drafts across project and view changes without writing repository content to browser storage.
export const useRepoTodoStore = create<{
  drafts: Record<string, TodoDraft>;
  saving: Record<string, boolean>;
  revision: number;
  setSaving: (key: string, saving: boolean, saved?: boolean) => void;
  setDraft: (key: string, draft: TodoDraft | null) => void;
}>((set) => ({
  drafts: {},
  saving: {},
  revision: 0,
  setSaving: (key, saving, saved = false) =>
    set((state) => ({
      saving: { ...state.saving, [key]: saving },
      revision: state.revision + Number(saved),
    })),
  setDraft: (key, draft) =>
    set((state) => {
      const drafts = { ...state.drafts };
      if (draft) drafts[key] = draft;
      else delete drafts[key];
      return { drafts };
    }),
}));

export const todoDraftKey = (projectPath: string, file: string) =>
  JSON.stringify([projectPath, file]);
