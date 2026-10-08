import { type LiveSession, sessionWork } from './live-session.ts';
import type { TaskRun } from './task-runtime.ts';

/** A bot's conversations, newest first. */
export function botConversations(sessions: LiveSession[], botId: string) {
  return sessions
    .filter((session) => session.persona?.botId === botId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The conversation a message from the bot's page continues: the latest one, while it still
 * accepts messages. A finished, paused, failed or integrated conversation starts a new one.
 */
export function continuableConversation(conversations: LiveSession[]) {
  const latest = conversations[0];
  return latest && !latest.closed && !latest.paused && !latest.error && !latest.integratedRunId
    ? latest
    : undefined;
}

/** When the bot last finished replying in a conversation. */
export function lastReplyAt(session: LiveSession, runs: TaskRun[]) {
  const ids = new Set(session.batches.map((batch) => batch.runId));
  let latest: string | null = null;
  for (const run of runs)
    if (ids.has(run.id) && run.endedAt && (!latest || run.endedAt > latest)) latest = run.endedAt;
  return latest;
}

/** A reply arrived after the person last read the conversation. */
export function isUnread(
  session: LiveSession,
  runs: TaskRun[],
  seen: Record<string, string>,
  floor: string,
) {
  const reply = lastReplyAt(session, runs);
  if (!reply || reply <= floor) return false;
  const read = seen[session.id];
  return !read || reply > read;
}

/** How many bot conversations have replies the person has not read. */
export function unreadBotConversations(
  sessions: LiveSession[],
  runs: TaskRun[],
  seen: Record<string, string>,
  floor: string,
) {
  return sessions.filter((session) => session.persona && isUnread(session, runs, seen, floor))
    .length;
}

/** The bot's mood from real activity: waiting on an answer, working or idle. */
export function botActivity(conversations: LiveSession[], runs: TaskRun[]) {
  let working = false;
  for (const session of conversations) {
    const work = sessionWork(session, runs);
    if (work.questions.length) return 'waiting' as const;
    if (work.active) working = true;
  }
  return working ? ('working' as const) : ('idle' as const);
}

/** Further replies a paused bot conversation may take each time the person lets it continue. */
export const BOT_BATCH_ALLOWANCE = 20;

/** A conversation a wake-up or another bot started reached its batch limit and waits on the person. */
export function batchLimitReached(session: LiveSession) {
  const limit = session.limits?.maxBatches;
  return (
    !!session.persona &&
    !session.closed &&
    !!limit &&
    session.batches.length >= limit &&
    !!session.error?.includes('batch limit')
  );
}
