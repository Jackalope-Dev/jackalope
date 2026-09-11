export function featureDraftKey(
  storage: Pick<Storage, 'getItem'>,
  projectId: string,
  legacy = false,
): string {
  const currentKey = `jackalope-feature-plan:${projectId}`;
  const legacyKey = `${currentKey}:multi`;
  if (legacy) return legacyKey;
  for (const key of [currentKey, legacyKey]) {
    try {
      const draft = JSON.parse(storage.getItem(key) ?? 'null');
      if (
        draft &&
        typeof draft.goal === 'string' &&
        typeof draft.agent === 'string' &&
        Array.isArray(draft.steps) &&
        !draft.added
      )
        return key;
    } catch {
      // Leave unreadable saved drafts intact.
    }
  }
  return currentKey;
}
