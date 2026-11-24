import { isActive } from '@jackalope/contracts/runs';
import { taskAgents } from './agent-provider.ts';
import { isAgentReview } from './agent-review.ts';
import { type LiveSession, sessionWork } from './live-session.ts';
import { managedTaskWork } from './managed-task.ts';
import type { QueueView } from './queue.ts';
import type { TaskRun } from './run-types.ts';
import { type WorkItem, workPresence } from './task-collection.ts';
import { liveActivity } from './task-live-activity.ts';

/**
 * Something running right now: a task, a conversation turn, a planned task's workers, a
 * bot's reply or an agent review. `item` opens it through openWork; a bot conversation
 * opens on the Bots page and an agent review opens the task it reviews.
 */
export interface LiveEntry {
  key: string;
  kind: 'task' | 'conversation' | 'planned' | 'bot' | 'review';
  title: string;
  projectId?: string;
  /** Agents doing the work, by id. */
  agents: string[];
  model: string | null;
  /** The step it is on, such as Working, Checking result or Queued. */
  phase: string;
  /** What it is doing within that step, from its newest activity. */
  current: string;
  /** When the running part started: the turn, attempt or the earliest busy worker. */
  since: string;
  /** An agent asked the person something and waits for the answer. */
  waiting: boolean;
  /** Busy workers of a planned task. */
  workers?: number;
  /** The schedule that started it. */
  schedule?: string;
  item?: WorkItem;
  session?: LiveSession;
  /** The attempt an agent review checks. */
  reviews?: string;
}

const waitingOnPerson = (run: TaskRun) =>
  !run.finishing && run.status !== 'stopping' && !!run.prompts?.some((p) => p.status === 'pending');

function entryFrom(
  base: Pick<LiveEntry, 'key' | 'kind' | 'title' | 'projectId' | 'item' | 'session' | 'reviews'>,
  active: TaskRun[],
  fallback: { agents: string[]; phase: string; since: string },
  schedules: Record<string, string>,
): LiveEntry {
  const started = (run: TaskRun) => Date.parse(run.startedAt) || 0;
  const lead = [...active].sort((a, b) => started(b) - started(a))[0];
  const activity = lead ? liveActivity(lead) : null;
  const waiting = active.some(waitingOnPerson);
  const agents = [...new Set(active.flatMap((run) => taskAgents(run)))];
  // Workers on different models have no single model to name.
  const models = [...new Set(active.flatMap((run) => run.model ?? run.requestedModel ?? []))];
  return {
    ...base,
    agents: agents.length ? agents : fallback.agents,
    model: models.length === 1 ? models[0] : null,
    phase: waiting ? 'Waiting for your answer' : (activity?.phase ?? fallback.phase),
    current: activity?.current ?? fallback.phase,
    since: active.length
      ? active.reduce(
          (first, run) => (started(run) < Date.parse(first) ? run.startedAt : first),
          lead.startedAt,
        )
      : fallback.since,
    waiting,
    workers: base.kind === 'planned' && active.length ? active.length : undefined,
    schedule: active.map((run) => schedules[run.id]).find(Boolean),
  };
}

interface LiveWorkInput {
  /** The workspace work list (collectWorkspaceWork without nesting). */
  items: WorkItem[];
  runs: TaskRun[];
  /** Every conversation, so bot replies are included. */
  sessions: LiveSession[];
  queue: QueueView;
  /** Schedule names by the attempt they started. */
  schedules?: Record<string, string>;
}

/**
 * Everything running across projects, from the work list, bot conversations and agent
 * reviews. Work waiting on the person comes first, then the most recently started.
 */
export function liveWork({
  items,
  runs,
  sessions,
  queue,
  schedules = {},
}: LiveWorkInput): LiveEntry[] {
  const entries: LiveEntry[] = [];
  for (const item of items) {
    const active = item.managed
      ? managedTaskWork(item.managed, queue, runs).active
      : item.session
        ? [sessionWork(item.session, runs).active].filter((run): run is TaskRun => !!run)
        : item.run && isActive(item.run)
          ? [item.run]
          : [];
    if (!active.length && item.stage !== 'working') continue;
    entries.push(
      entryFrom(
        {
          key: item.id,
          kind: item.managed ? 'planned' : item.session ? 'conversation' : 'task',
          title: item.title,
          projectId:
            item.run?.projectId ??
            item.session?.request.projectId ??
            item.managed?.request.projectId,
          item,
        },
        active,
        {
          agents: workPresence(item).agents,
          phase: item.statusLabel || 'Queued',
          since: item.date,
        },
        schedules,
      ),
    );
  }
  for (const session of sessions) {
    if (!session.persona) continue;
    const active = sessionWork(session, runs).active;
    if (!active) continue;
    entries.push(
      entryFrom(
        {
          key: `bot:${session.id}`,
          kind: 'bot',
          title: session.title,
          projectId: session.request.projectId,
          session,
        },
        [active],
        { agents: [], phase: 'Working', since: active.startedAt },
        schedules,
      ),
    );
  }
  for (const run of runs) {
    if (!isAgentReview(run) || !isActive(run)) continue;
    const reviewed = runs.find((other) => other.id === run.challengeOf?.runId);
    const owner = items.find(
      (item) => item.run?.id === reviewed?.id || item.run?.taskId === reviewed?.taskId,
    );
    entries.push(
      entryFrom(
        {
          key: `review:${run.id}`,
          kind: 'review',
          title: owner?.title ?? run.prompt,
          projectId: run.projectId,
          item: owner,
          reviews: reviewed?.id,
        },
        [run],
        { agents: [], phase: 'Reviewing', since: run.startedAt },
        schedules,
      ),
    );
  }
  return entries.sort(
    (a, b) =>
      Number(b.waiting) - Number(a.waiting) ||
      (Date.parse(b.since) || 0) - (Date.parse(a.since) || 0),
  );
}
