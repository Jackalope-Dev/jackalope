import {
  latestTasks,
  type Snapshot,
  sessionStatus,
  taskStatus,
  type WorkStatus,
  waitingSessions,
  workTitle,
} from '@jackalope/contracts/remote';

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
  projectName: string;
  agent?: string;
  /** Absent for conversations that have not run anything yet. */
  startedAt?: string;
  status: WorkStatus;
}

export function workRows(snapshot: Snapshot | null): WorkRow[] {
  const tasks = latestTasks(snapshot);
  const project = (id: string) => snapshot?.projects.find((item) => item.id === id)?.name ?? '';
  return [
    ...waitingSessions(snapshot, tasks).map((session) => ({
      id: session.id,
      title: session.title,
      projectName: project(session.projectId),
      status: sessionStatus(session),
    })),
    ...tasks.map((task) => ({
      id: task.sessionId || task.taskId,
      title: workTitle(task.title),
      projectName: task.projectName,
      agent: task.agent,
      startedAt: task.startedAt,
      status: taskStatus(task),
    })),
  ];
}

/** Conversations that have not run anything lead their group, then the newest work. */
function newestFirst(a: WorkRow, b: WorkRow) {
  if (!a.startedAt || !b.startedAt) return a.startedAt ? 1 : b.startedAt ? -1 : 0;
  return b.startedAt.localeCompare(a.startedAt);
}

/** Rows sorted and grouped by what they need from the person; empty groups are kept. */
export function groupWork<T extends WorkRow>(rows: T[]): [string, T[]][] {
  const sorted = [...rows].sort(newestFirst);
  return [
    ['Needs you', sorted.filter((row) => row.status.needsYou)],
    ['Working', sorted.filter((row) => row.status.working)],
    ['Recent', sorted.filter((row) => !row.status.needsYou && !row.status.working)],
  ];
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
