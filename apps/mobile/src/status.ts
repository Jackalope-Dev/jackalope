import {
  latestTasks,
  type Snapshot,
  sessionStatus,
  taskStatus,
  type WorkStatus,
  waitingSessions,
  workTitle,
} from '@jackalope/contracts/remote';
import { withoutLeadingId } from '../../desktop/src/lib/task-title.ts';

/** "now", "5m", "3h", "2d": short enough for a list row. */
export function since(iso: string, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** One item of a computer's work as a list row; `id` is what that computer selects it by. */
export interface WorkRow {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  /** Parent folders telling this project apart from another of the same name. */
  projectHint?: string;
  agent?: string;
  /** Absent for conversations that have not run anything yet. */
  startedAt?: string;
  status: WorkStatus;
  /** A conversation opens to its thread; a task to its result. */
  conversation: boolean;
}

export function workRows(snapshot: Snapshot | null): WorkRow[] {
  const tasks = latestTasks(snapshot);
  const project = (id: string) => snapshot?.projects.find((item) => item.id === id);
  return [
    ...waitingSessions(snapshot, tasks).map((session) => ({
      id: session.id,
      title: withoutLeadingId(session.title),
      projectId: session.projectId,
      projectName: project(session.projectId)?.name ?? '',
      projectHint: project(session.projectId)?.hint,
      status: sessionStatus(session),
      conversation: true,
    })),
    ...tasks.map((task) => ({
      id: task.sessionId || task.taskId,
      title: withoutLeadingId(workTitle(task.title)),
      projectId: task.projectId,
      projectName: task.projectName,
      projectHint: project(task.projectId)?.hint,
      agent: task.agent,
      startedAt: task.startedAt,
      status: taskStatus(task),
      conversation: Boolean(task.sessionId),
    })),
  ];
}

/** Conversations that have not run anything lead their group, then the newest work. */
function newestFirst(a: WorkRow, b: WorkRow) {
  if (!a.startedAt || !b.startedAt) return a.startedAt ? 1 : b.startedAt ? -1 : 0;
  return b.startedAt.localeCompare(a.startedAt);
}

/** Queued and paused work is still underway, as the desktop lists it, not finished. */
const UNDERWAY = new Set(['Queued', 'Paused']);

function groupOf(status: WorkStatus) {
  if (status.needsYou) return 'Needs you';
  return status.working || UNDERWAY.has(status.label) ? 'Working' : 'Finished';
}

/** Rows sorted and grouped by what they need from the person; empty groups are kept. */
export function groupWork<T extends WorkRow>(rows: T[]): [string, T[]][] {
  const sorted = [...rows].sort(newestFirst);
  return (['Needs you', 'Working', 'Finished'] as const).map((group) => [
    group,
    sorted.filter((row) => groupOf(row.status) === group),
  ]);
}

/**
 * What tapping a row does, in the desktop's words, and whether its status adds anything
 * beside that verb and its group (an answer, a review or work in progress already say it).
 */
export function workAction(row: Pick<WorkRow, 'status' | 'conversation'>) {
  const { label } = row.status;
  const thing = row.conversation ? 'conversation' : 'task';
  if (label === 'Needs your answer') return { action: 'Answer question', showStatus: false };
  if (label === 'Ready to review')
    return { action: row.conversation ? 'Reply' : 'Review result', showStatus: false };
  if (label === 'Working') return { action: 'View activity', showStatus: false };
  if (label === 'Needs attention') return { action: `Inspect ${thing}`, showStatus: true };
  if (label === 'Done')
    return { action: row.conversation ? 'Open conversation' : 'Open result', showStatus: false };
  return { action: `Open ${thing}`, showStatus: true };
}

/** Work waiting on the person this long sits under "Older" in Needs you, as on the desktop. */
const OLDER_MS = 7 * 24 * 60 * 60 * 1000;

export function isOlder(row: Pick<WorkRow, 'startedAt'>, now = Date.now()) {
  return Boolean(row.startedAt && now - Date.parse(row.startedAt) > OLDER_MS);
}

/** "2 need you · 1 working", or nothing when the computer is idle. */
export function workSummary(rows: WorkRow[]) {
  const needsYou = rows.filter((row) => row.status.needsYou).length;
  const working = rows.filter((row) => row.status.working).length;
  return [
    needsYou && `${needsYou} need${needsYou === 1 ? 's' : ''} you`,
    working && `${working} working`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The native error when a computer doesn't answer at all, as opposed to answering with an error. */
const UNREACHABLE = 'The host is unreachable';

/**
 * How an unreachable computer reads: "offline" when it doesn't answer at all, else that it
 * answered but couldn't be used (a removed device, a bad response); the real error stays
 * available beside this.
 */
export function connectionState(error: string) {
  return error.startsWith(UNREACHABLE) || error.startsWith('Connection interrupted')
    ? 'offline'
    : "can't connect";
}

/** "last seen 2h ago", or that this phone hasn't reached it yet. */
export function lastSeen(iso: string | undefined, now = Date.now()) {
  if (!iso) return 'not reached from this phone yet';
  const ago = since(iso, now);
  return ago === 'now' ? 'last seen just now' : `last seen ${ago} ago`;
}
