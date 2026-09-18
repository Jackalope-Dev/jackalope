const prefix = 'jackalope-work-feedback:';
export interface WorkFeedback {
  key: string;
  taskId: string;
  runId: string;
  text: string;
  createdAt: string;
}
export function pendingWorkFeedback(taskId: string): WorkFeedback[] {
  const values: WorkFeedback[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(`${prefix}${taskId}:`)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (
        value?.taskId === taskId &&
        typeof value.text === 'string' &&
        typeof value.runId === 'string' &&
        typeof value.createdAt === 'string'
      )
        values.push({ ...value, key });
    } catch {
      /* An incomplete record remains available for recovery. */
    }
  }
  return values.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function saveWorkFeedback(taskId: string, runId: string, text: string) {
  if (new TextEncoder().encode(text).length > 24000)
    throw new Error('Keep feedback below 24,000 bytes.');
  if (pendingWorkFeedback(taskId).length >= 20)
    throw new Error('Add or dismiss existing feedback in the task before saving more.');
  const key = `${prefix}${taskId}:${crypto.randomUUID()}`;
  localStorage.setItem(
    key,
    JSON.stringify({ taskId, runId, text, createdAt: new Date().toISOString() }),
  );
  window.dispatchEvent(new Event('jackalope:work-feedback'));
}
