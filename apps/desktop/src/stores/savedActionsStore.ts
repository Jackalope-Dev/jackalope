import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createPersistStorage } from '../lib/persist-storage.ts';

export interface SavedAction {
  id: string;
  name: string;
  kind: 'prompt' | 'command';
  body: string;
  projectId: string | null;
}
export function validSavedAction(value: unknown): value is SavedAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as SavedAction;
  return (
    typeof action.id === 'string' &&
    typeof action.name === 'string' &&
    !!action.name.trim() &&
    action.name.length <= 80 &&
    ['prompt', 'command'].includes(action.kind) &&
    typeof action.body === 'string' &&
    !!action.body.trim() &&
    action.body.length <= 12000 &&
    (action.projectId === null || typeof action.projectId === 'string')
  );
}
export const useSavedActionsStore = create<{
  actions: SavedAction[];
  save: (action: SavedAction) => void;
  remove: (id: string) => void;
}>()(
  persist(
    (set) => ({
      actions: [],
      save: (action) => {
        if (!validSavedAction(action))
          throw new Error('Give this action a name and text, up to 12,000 characters.');
        set((state) => ({
          actions: [...state.actions.filter((item) => item.id !== action.id), action].slice(-100),
        }));
      },
      remove: (id) =>
        set((state) => ({ actions: state.actions.filter((action) => action.id !== id) })),
    }),
    {
      name: 'jackalope-saved-actions-v1',
      storage: createPersistStorage(),
      merge: (saved, current) => ({
        ...current,
        actions: Array.isArray((saved as { actions?: unknown[] })?.actions)
          ? (saved as { actions: unknown[] }).actions.filter(validSavedAction).slice(-100)
          : [],
      }),
    },
  ),
);
