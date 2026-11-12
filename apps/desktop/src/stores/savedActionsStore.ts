/**
 * Saved actions were reusable prompts and terminal commands kept on this device. Prompts are
 * now reusable workflows and commands are project terminal commands (see
 * lib/saved-actions-migration.ts). The saved list is only read, never rewritten, so an older
 * version still finds it after a downgrade.
 */
export interface SavedAction {
  id: string;
  name: string;
  kind: 'prompt' | 'command';
  body: string;
  projectId: string | null;
}

export const LEGACY_SAVED_ACTIONS_KEY = 'jackalope-saved-actions-v1';

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

/** The saved actions an earlier version persisted, or none when there are none or they can't be read. */
export function readLegacySavedActions(
  storage: Pick<Storage, 'getItem'> | undefined,
): SavedAction[] {
  try {
    const raw = storage?.getItem(LEGACY_SAVED_ACTIONS_KEY);
    if (!raw) return [];
    const actions = (JSON.parse(raw) as { state?: { actions?: unknown } })?.state?.actions;
    return Array.isArray(actions) ? actions.filter(validSavedAction).slice(-100) : [];
  } catch {
    return [];
  }
}
