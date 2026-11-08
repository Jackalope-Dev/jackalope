import { draftKey } from '@jackalope/contracts/remote';

/** Where a computer's work keeps its state on this phone, drafts included. */
export const workspaceKey = (hostId: string) => `jackalope-mobile:${hostId}`;

const newWorkDraftKey = (hostId: string) => draftKey(workspaceKey(hostId), { newWork: true });

/**
 * Moves the new-work draft typed so far to another computer. Only the text moves: the
 * saved send request belongs to the first computer and must not be replayed on another.
 * Returns false when storage is unavailable, so the new computer's form starts empty.
 */
export function moveNewWorkDraft(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  from: string,
  to: string,
) {
  try {
    const draft = storage.getItem(newWorkDraftKey(from));
    if (draft) {
      storage.setItem(newWorkDraftKey(to), draft);
      storage.removeItem(newWorkDraftKey(from));
    }
    return true;
  } catch {
    return false;
  }
}
