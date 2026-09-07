import { create } from 'zustand';

export interface TodoDraft {
  base: string | null;
  content: string;
}

// Keep drafts across project and view changes without writing repository content to browser storage.
export const useRepoTodoStore = create<{
  drafts: Record<string, TodoDraft>;
  setDraft: (key: string, draft: TodoDraft | null) => void;
}>((set) => ({
  drafts: {},
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
