import type { BadgeProps } from '@jackalope/ui';
import type {
  RemoteSession,
  RemoteTask,
} from '../../desktop/src/components/remote/useRemoteWorkspace';

export interface WorkStatus {
  label: string;
  variant: NonNullable<BadgeProps['variant']>;
  /** Work waiting on the person sorts first and shows on the host card. */
  needsYou: boolean;
  working: boolean;
}

/** One label per state, in the desktop's words, so the phone reads like the sidebar. */
export function taskStatus(task: RemoteTask): WorkStatus {
  if (task.prompts.some((prompt) => prompt.status === 'pending'))
    return { label: 'Needs your answer', variant: 'warning', needsYou: true, working: false };
  if (['starting', 'running', 'stopping'].includes(task.status))
    return { label: 'Working', variant: 'accent', needsYou: false, working: true };
  if (task.status === 'review')
    return { label: 'Ready to review', variant: 'success', needsYou: true, working: false };
  if (task.status === 'reviewed')
    return { label: 'Done', variant: 'default', needsYou: false, working: false };
  if (task.error || ['failed', 'interrupted'].includes(task.status))
    return { label: 'Needs attention', variant: 'danger', needsYou: true, working: false };
  if (task.status === 'stopped')
    return { label: 'Stopped', variant: 'default', needsYou: false, working: false };
  return { label: 'Queued', variant: 'default', needsYou: false, working: false };
}

export function sessionStatus(session: RemoteSession): WorkStatus {
  if (session.error)
    return { label: 'Needs attention', variant: 'danger', needsYou: true, working: false };
  if (session.paused)
    return { label: 'Paused', variant: 'default', needsYou: false, working: false };
  return { label: 'Queued', variant: 'default', needsYou: false, working: false };
}

/** "now", "5m", "3h", "2d": short enough for a list row. */
export function since(iso: string, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
