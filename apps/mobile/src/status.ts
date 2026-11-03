import type { BadgeProps } from '@jackalope/ui';
import {
  latestTasks,
  type RemoteSession,
  type RemoteTask,
  type Snapshot,
  waitingSessions,
} from '../../desktop/src/components/remote/useRemoteWorkspace.ts';

export interface WorkStatus {
  label: string;
  variant: NonNullable<BadgeProps['variant']>;
  /** Work waiting on the person sorts first and counts toward its computer's summary. */
  needsYou: boolean;
  working: boolean;
}

/** One label per state, in the desktop's words, so the phone reads like the sidebar. */
export function taskStatus(task: RemoteTask): WorkStatus {
  const active = ['starting', 'running', 'stopping'].includes(task.status);
  // A question left by an attempt that ended can no longer be answered there. Hosts that
  // predate unanswered questions in their lists send none, so those rows read Working.
  if (active && task.prompts.some((prompt) => prompt.status === 'pending'))
    return { label: 'Needs your answer', variant: 'warning', needsYou: true, working: false };
  if (active) return { label: 'Working', variant: 'accent', needsYou: false, working: true };
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

const LIVE_SESSION = /^\s*Live session:\s*/;
/** The line a live session's batch puts before each message: its author, then its id. */
const BATCH_MESSAGE =
  /^(?:User message|User answer \(.*\)|Wake-up \(.*\)|(?:Message from|Reply from) bot .*) [0-9a-f-]{36}:$/i;

/**
 * What the person asked. A live session's prompt is its title, the host's batch
 * instructions, then each message, so only the messages are kept; the short list title
 * stops before them, so it falls back to the session title.
 */
export function requestText(prompt: string) {
  if (!LIVE_SESSION.test(prompt)) return prompt.trim();
  const messages: string[][] = [];
  for (const line of prompt.split(/\r?\n/)) {
    if (BATCH_MESSAGE.test(line)) messages.push([]);
    else messages.at(-1)?.push(line);
  }
  const asked = messages
    .map((lines) => lines.join('\n').trim())
    .filter(Boolean)
    .join('\n\n');
  return asked || (prompt.replace(LIVE_SESSION, '').split(/\r?\n/)[0] ?? '').trim();
}

/** Markdown that opens a line (headings, quotes, bullets) and bold or code markers. */
const LINE_START = /^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/;
const INLINE_MARKS = /\*\*|`/g;

/**
 * A short title from the request's first line. A heading such as "### Objective" names a
 * section rather than the work, so the line after it is used when there is one.
 */
export function workTitle(prompt: string) {
  const lines = prompt
    .replace(LIVE_SESSION, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const first = lines[0] ?? '';
  const chosen = /^\s*#{1,6}\s/.test(first) && lines[1] ? lines[1] : first;
  return chosen.replace(LINE_START, '').replace(INLINE_MARKS, '').trim() || 'Untitled work';
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
