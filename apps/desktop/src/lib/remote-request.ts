export function prepareRemoteRequest<T extends { action: string; runId?: string }>(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  action: T,
): T & { id: string } {
  const signature = JSON.stringify(action);
  const saved = storage.getItem(key);
  if (saved) {
    const receipt = JSON.parse(saved);
    if (typeof receipt.signature !== 'string' || typeof receipt.id !== 'string')
      throw new Error('The saved request could not be read.');
    const previous = JSON.parse(receipt.signature);
    const identity = (value: T) =>
      JSON.stringify(value.action === 'followup' ? { ...value, runId: undefined } : value);
    if (identity(previous) === identity(action))
      return { ...action, runId: previous.runId, id: receipt.id };
  }
  const id = crypto.randomUUID();
  storage.setItem(key, JSON.stringify({ id, signature }));
  return { ...action, id };
}
