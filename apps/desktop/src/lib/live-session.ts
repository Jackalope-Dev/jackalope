import type { RunRequest, TaskRun } from './task-runtime.ts';
import { isActive, nativeTask } from './task-runtime.ts';

export interface SessionMessage {
  id: string;
  text: string;
  createdAt: string;
  runId: string | null;
  canceled: boolean;
  /** Set when the message came from a wake-up, another bot or a card answer rather than typing. */
  origin?: MessageOrigin;
}
export interface MessageOrigin {
  kind: 'wake' | 'bot' | 'reply' | 'card';
  label: string;
  botId?: string;
  botName?: string;
  sessionId?: string;
}
export interface SessionBatch {
  runId: string;
  messageIds: string[];
  previousRunId: string | null;
  error: string | null;
  settled: boolean;
}
export interface SessionDraft {
  text: string;
  revision: number;
}
/** Standing instructions from a saved bot, repeated natively in every batch. */
export interface SessionPersona {
  botId: string;
  name: string;
  instructions: string;
}

export interface LiveSession {
  persona?: SessionPersona;
  topics?: SessionTopic[];
  topicsRevision?: number;
  limits?: SessionLimits;
  integratedRunId?: string | null;
  id: string;
  title: string;
  request: RunRequest;
  createdAt: string;
  updatedAt: string;
  paused: boolean;
  closed: boolean;
  pinned: boolean;
  messages: SessionMessage[];
  batches: SessionBatch[];
  draft: SessionDraft;
  error: string | null;
}
export interface SessionTopic {
  id: string;
  title: string;
  messageIds: string[];
}
export interface SessionLimits {
  maxBatches: number | null;
  pauseAtEstimatedUsd: number | null;
}
export interface SessionSnapshot {
  revisions?: Record<string, string>;
  sessions: LiveSession[];
  runs: TaskRun[];
  error: string | null;
}
export interface SessionReview {
  files: string[];
  diff: string;
  note: string;
  patchPath: string;
  tree: string;
  verified: boolean;
}
export const sessionCommand = <T>(command: string, args?: Record<string, unknown>) =>
  nativeTask<T>(`live_session_${command}`, args);

export function sessionRunNeedsAttention(run: TaskRun) {
  return (
    !['review', 'reviewed'].includes(run.status) ||
    !!run.error ||
    !!run.persistenceError ||
    !!run.verificationError ||
    run.verification?.result.success === false
  );
}

export function sessionWork(session: LiveSession, runs: TaskRun[]) {
  const ids = new Set(session.batches.map((batch) => batch.runId));
  const work = runs.filter((run) => ids.has(run.id));
  const byId = new Map(work.map((run) => [run.id, run]));
  const batches = new Map(session.batches.map((batch) => [batch.runId, batch]));
  const latest = session.batches
    .map((batch) => byId.get(batch.runId))
    .filter((run): run is TaskRun => !!run)
    .at(-1);
  const active = work.find(isActive);
  const pending = session.messages.filter(
    (message) =>
      !message.canceled &&
      (!message.runId || (!byId.has(message.runId) && !batches.get(message.runId)?.error)),
  ).length;
  const questions = active?.prompts?.filter((prompt) => prompt.status === 'pending') ?? [];
  const failed = latest && !isActive(latest) && sessionRunNeedsAttention(latest);
  const status = session.integratedRunId
    ? 'Integrated'
    : session.closed
      ? 'Finished'
      : questions.length
        ? 'Needs input'
        : active?.finishing
          ? 'Checking'
          : active
            ? 'Working'
            : session.error || failed
              ? 'Needs attention'
              : session.paused
                ? 'Paused'
                : pending
                  ? 'Queued'
                  : latest
                    ? 'Ready to review'
                    : 'Ready';
  return { work, latest, active, pending, questions, status };
}
