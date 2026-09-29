import type { WorkItem } from './task-collection';
import type { TaskRun } from './task-runtime';

/** Read-state fields used to decide whether work is unread. */
export interface ReadState {
  since: string;
  seen: Record<string, string>;
  unread: Record<string, true>;
}

/** Stable identity for read state: a task, a chat or a managed plan. */
export function signalKey(item: WorkItem) {
  if (item.managed) return `managed:${item.managed.id}`;
  if (item.session) return `session:${item.session.id}`;
  return item.run?.taskId ?? item.id;
}

/** When the item last produced something worth reading. */
function activityTime(item: WorkItem) {
  const run = item.run;
  if (run?.prompts?.some((prompt) => prompt.status === 'pending')) return run.startedAt;
  return run?.endedAt ?? item.session?.updatedAt ?? item.date;
}

export function isUnread(item: WorkItem, signals: ReadState, openKey: string | null) {
  if (!item.run && !item.session && !item.managed) return false;
  const key = signalKey(item);
  if (key === openKey) return false;
  if (signals.unread[key]) return true;
  if (!['attention', 'review', 'finished'].includes(item.stage)) return false;
  const { seen, since } = signals;
  const time = activityTime(item);
  const seenAt = seen[key];
  return time > since && (!seenAt || time > seenAt);
}

/** The work key currently open in the main view, used to mark it read. */
export function openSignalKey(
  selectedRun: TaskRun | undefined,
  selectedSession: string | null,
  selectedManaged: string | null,
) {
  if (selectedManaged) return `managed:${selectedManaged}`;
  if (selectedSession) return `session:${selectedSession}`;
  return selectedRun?.taskId ?? null;
}

export function compactElapsed(since: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d`;
}
