import { isActive, needsAttention, type PendingUserPrompt } from './runs.ts';

/** One request a companion sends to a paired host's `/api/request`. */
export interface RemoteAction {
  action: string;
  id?: string;
  projectId?: string;
  runId?: string;
  sessionId?: string;
  promptId?: string;
  text?: string;
}
export type RemoteRequest = <T>(action: RemoteAction) => Promise<T>;
export interface RemoteTask {
  id: string;
  taskId: string;
  sessionId: string | null;
  projectId: string;
  projectName: string;
  /** Hosts before this field was added omit it. */
  agent?: string;
  title: string;
  status: string;
  result: string;
  error: string | null;
  /** Where the agent runs, in a task's detail; older hosts omit it. */
  host?: string | null;
  /** A conversation attempt's messages, in a task's detail; older hosts omit it. */
  messages?: string[];
  startedAt: string;
  prompts: PendingUserPrompt[];
  activity: string[];
}
export interface RemoteSession {
  id: string;
  title: string;
  projectId: string;
  paused: boolean;
  error: string | null;
  pending: number;
}
/** A project a host shares. Hosts before `hint` and the icon fields send only id and name. */
export interface RemoteProject {
  id: string;
  name: string;
  /** Parent folders that tell projects with the same name apart. */
  hint?: string;
  /** The host's sidebar icon key, such as "rocket" or "website". */
  icon?: string;
  /** Changes when the project's icon image does; fetch it with the `projectIcons` action. */
  iconVersion?: string;
}
export interface Snapshot {
  projects: RemoteProject[];
  tasks: RemoteTask[];
  sessions: RemoteSession[];
}

/** One row per conversation or task: the latest attempt stands for its thread. */
export function latestTasks(snapshot: Snapshot | null) {
  return [
    ...new Map(
      [...(snapshot?.tasks ?? [])].reverse().map((task) => [task.sessionId || task.taskId, task]),
    ).values(),
  ].reverse();
}

/** Conversations with nothing run yet have no task row of their own. */
export function waitingSessions(snapshot: Snapshot | null, latest = latestTasks(snapshot)) {
  return (
    snapshot?.sessions.filter((session) => !latest.some((task) => task.sessionId === session.id)) ??
    []
  );
}

/** Where a workspace keeps the draft for one item, or for new work. */
export const draftKey = (workspace: string, item: string | { newWork: true }) =>
  `${workspace}:draft:${typeof item === 'string' ? item : 'new'}`;

/** Where a draft's pending send request is saved beside it. */
export const requestKey = (draft: string) => `${draft}:request`;

/**
 * The send request for `action`, with an id saved under `key`. Sending the same request
 * again (after a lost response) reuses the id, so the host does not run it twice; a
 * follow-up keeps the run it was first aimed at.
 */
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

export interface WorkStatus {
  label: string;
  variant: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  /** Work waiting on the person sorts first and counts toward its computer's summary. */
  needsYou: boolean;
  working: boolean;
}

/** One label per state, in the desktop's words, so a companion reads like the sidebar. */
export function taskStatus(task: RemoteTask): WorkStatus {
  const active = isActive(task);
  // A question left by an attempt that ended can no longer be answered there. Hosts that
  // predate unanswered questions in their lists send none, so those rows read Working.
  if (active && task.prompts.some((prompt) => prompt.status === 'pending'))
    return { label: 'Needs your answer', variant: 'warning', needsYou: true, working: false };
  if (active) return { label: 'Working', variant: 'accent', needsYou: false, working: true };
  if (task.status === 'review')
    return { label: 'Ready to review', variant: 'success', needsYou: true, working: false };
  if (task.status === 'reviewed')
    return { label: 'Done', variant: 'default', needsYou: false, working: false };
  if (task.error || needsAttention(task))
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

/**
 * What the person asked of a task: the messages a conversation attempt handled when the
 * host sends them, else read from its prompt (hosts before `messages`).
 */
export function askedText(task: Pick<RemoteTask, 'title' | 'messages'>) {
  const messages = task.messages?.map((text) => text.trim()).filter(Boolean);
  return messages?.length ? messages.join('\n\n') : requestText(task.title);
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
