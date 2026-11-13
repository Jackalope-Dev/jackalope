import { isActive, isTerminal } from '@jackalope/contracts/runs';
import type { TaskTicket } from '../stores/taskStore.ts';
import { taskAgents } from './agent-provider.ts';
import { isAgentReview } from './agent-review.ts';
import { type LiveSession, sessionWork } from './live-session.ts';
import { type ManagedTask, managedTaskWork } from './managed-task.ts';
import type { QueueView } from './queue.ts';
import type { TaskRun } from './run-types.ts';
import { taskTitle, withoutLeadingId } from './task-title.ts';
import { hasOpenQuestion, taskDecision, taskNextAction } from './task-workflow.ts';

const workStages = [
  { id: 'attention', label: 'Needs you' },
  { id: 'review', label: 'Ready to review' },
  { id: 'working', label: 'Working' },
  { id: 'ideas', label: 'Drafts' },
  { id: 'finished', label: 'Finished' },
] as const;

export const workGroups = workStages.filter((stage) => stage.id !== 'review');

export function workGroup(stage: string) {
  return stage === 'review' ? 'attention' : stage;
}

export function matchesWorkFilter(item: WorkItem, filter: string) {
  return filter === 'all' || workGroup(item.stage) === workGroup(filter);
}

export interface WorkItem {
  id: string;
  title: string;
  stage: (typeof workStages)[number]['id'];
  date: string;
  idea?: TaskTicket;
  run?: TaskRun;
  session?: LiveSession;
  managed?: ManagedTask;
  statusLabel?: string;
  archiveBlocked?: string;
  /** A question the person can answer now (see hasOpenQuestion); collection sets it. */
  question?: boolean;
}

/**
 * Every row in the work list is one piece of work; its shape says how it runs:
 * a conversation you keep messaging, a single task, a task the agent planned
 * into subtasks, or a draft not started yet.
 */
export function workShape(item: WorkItem) {
  if (item.managed) return 'Planned task';
  if (item.session) return 'Conversation';
  if (item.run) return 'Task';
  return 'Draft';
}

export function selectedManagedTask(
  queue: QueueView,
  runs: TaskRun[],
  taskId: string | null,
  runId: string | null,
  projectId: string | null = null,
) {
  const ownsRun = (task: ManagedTask) =>
    task.plannerRunId === runId ||
    task.runIds.includes(runId ?? '') ||
    managedTaskWork(task, queue, runs).work.some((run) => run.id === runId);
  const tasks = (queue.managedTasks ?? []).filter(
    (task) => projectId === null || task.request.projectId === projectId,
  );
  if (!taskId) return runId ? tasks.find(ownsRun) : undefined;
  const task = tasks.find((task) => task.id === taskId);
  return task && (!runId || ownsRun(task)) ? task : undefined;
}

export function workPresence(item: WorkItem): {
  agents: string[];
  state: 'idle' | 'working' | 'waiting';
  action: string;
} {
  const run = item.run;
  const question = item.question ?? (!!run && hasOpenQuestion(run));
  const agents = taskAgents(
    run,
    item.managed?.request.agent ?? item.session?.request.agent ?? item.idea?.assignedAgent,
  );
  const state = question
    ? 'waiting'
    : (run && isActive(run)) || item.stage === 'working'
      ? 'working'
      : 'idle';
  const action = item.managed
    ? item.stage === 'attention'
      ? 'Inspect task'
      : item.stage === 'review'
        ? 'Review task'
        : 'Open task'
    : item.session
      ? question
        ? 'Answer question'
        : item.stage === 'attention'
          ? 'Inspect conversation'
          : item.stage === 'working'
            ? 'View activity'
            : item.stage === 'review'
              ? 'Reply'
              : 'Open conversation'
      : run
        ? item.stage === 'finished'
          ? 'Open result'
          : taskNextAction(run)
        : 'Open draft';
  return { agents, state, action };
}

interface WorkspaceWorkOptions {
  ideas?: TaskTicket[];
  sessions?: LiveSession[];
  queue?: QueueView;
  /** Attempts merged into their target; the queue's merged attempts when left out. */
  integratedRunIds?: string[];
  archived?: boolean;
  /** Also list attempts that belong to a managed task. */
  nested?: boolean;
}

export function collectWorkspaceWork(
  projectId: string | null,
  runs: TaskRun[],
  {
    ideas = [],
    sessions = [],
    queue,
    integratedRunIds = queue?.mergedRunIds ?? [],
    archived = false,
    nested = false,
  }: WorkspaceWorkOptions = {},
): WorkItem[] {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const managedWork = (queue?.managedTasks ?? [])
    .filter((task) => projectId === null || task.request.projectId === projectId)
    .map((task) => ({ task, work: managedTaskWork(task, queue as QueueView, runs) }));
  const childIds = new Set(managedWork.flatMap(({ work }) => work.work.map((run) => run.id)));
  const parentProjects = new Map(managedWork.map(({ task }) => [task.id, task.request.projectId]));
  const items = collectWork(
    projectId,
    ideas.filter((idea) => !idea.runId || parentProjects.get(idea.runId) !== idea.projectId),
    runs.filter(
      (run) =>
        (nested || !childIds.has(run.id)) &&
        (!run.liveSessionId || !sessionIds.has(run.liveSessionId)),
    ),
    integratedRunIds,
    archived,
    nested,
  );
  if (!archived)
    for (const { task, work } of managedWork) {
      items.push({
        id: `managed:${task.id}`,
        title: task.title,
        date: task.createdAt,
        managed: task,
        statusLabel: work.status,
        idea: ideas.find(
          (idea) => idea.runId === task.id && idea.projectId === task.request.projectId,
        ),
        question: work.questions.length > 0,
        stage: work.integrated
          ? 'finished'
          : work.questions.length || work.failed || work.status === 'Needs attention'
            ? 'attention'
            : work.active.length || work.status === 'Queued'
              ? 'working'
              : work.status === 'Paused'
                ? 'attention'
                : 'review',
        run: work.combined ?? work.planner,
        archiveBlocked: 'This task retains its planning and worker history together.',
      });
    }
  if (!archived)
    for (const session of sessions) {
      if (projectId !== null && session.request.projectId !== projectId) continue;
      // Bot conversations live in the Bots view.
      if (session.persona && !nested) continue;
      const work = sessionWork(session, runs);
      // A closed conversation can't take an answer, so a question left in it doesn't need you.
      const question = !session.closed && work.work.some(hasOpenQuestion);
      items.push({
        id: `session:${session.id}`,
        title: withoutLeadingId(session.title),
        date: session.updatedAt,
        question,
        stage:
          question || work.status === 'Needs attention'
            ? 'attention'
            : work.active || work.pending
              ? 'working'
              : session.closed
                ? 'finished'
                : work.latest
                  ? 'review'
                  : 'ideas',
        run: work.latest,
        session,
        statusLabel: work.status,
        archiveBlocked: 'A conversation stays together. Open it to finish or resume it.',
      });
    }
  return items.sort(
    (a, b) =>
      workStages.findIndex((s) => s.id === a.stage) -
        workStages.findIndex((s) => s.id === b.stage) || Date.parse(b.date) - Date.parse(a.date),
  );
}

export function collectWork(
  projectId: string | null,
  ideas: TaskTicket[],
  runs: TaskRun[],
  integratedRunIds: string[] = [],
  archived = false,
  withReviews = false,
): WorkItem[] {
  // Agent reviews belong to the task they review and open from its Review tab.
  const projectRuns = runs.filter(
    (run) =>
      (projectId === null || run.projectId === projectId) && (withReviews || !isAgentReview(run)),
  );
  const byId = new Map(projectRuns.map((run) => [run.id, run]));
  const latest = new Map<string, TaskRun>();
  const original = new Map<string, TaskRun>();
  const blocked = new Set<string>();
  for (const run of projectRuns) {
    if (!isTerminal(run) || run.finishing || run.liveSessionId || run.persistenceError)
      blocked.add(run.taskId);
    const newest = latest.get(run.taskId);
    const oldest = original.get(run.taskId);
    if (!newest || Date.parse(run.startedAt) > Date.parse(newest.startedAt))
      latest.set(run.taskId, run);
    if (!oldest || Date.parse(run.startedAt) < Date.parse(oldest.startedAt))
      original.set(run.taskId, run);
  }
  const linkedIdeas = new Map<string, TaskTicket>();
  const items: WorkItem[] = [];
  for (const idea of ideas.filter((idea) => projectId === null || idea.projectId === projectId)) {
    const run = idea.runId ? (byId.get(idea.runId) ?? latest.get(idea.runId)) : undefined;
    if (run) {
      linkedIdeas.set(run.taskId, idea);
    } else {
      if (!!idea.archivedAt !== archived) continue;
      items.push({
        id: idea.id,
        title: taskTitle(idea.rawPrompt, idea.title),
        stage: idea.runId ? 'attention' : idea.status === 'done' ? 'finished' : 'ideas',
        date: idea.updatedAt,
        idea,
      });
    }
  }
  for (const run of latest.values()) {
    if (!!run.archivedAt !== archived) continue;
    const idea = linkedIdeas.get(run.taskId);
    const active = isActive(run);
    const question = hasOpenQuestion(run);
    items.push({
      id: idea?.id ?? run.taskId,
      title: taskTitle(
        idea?.rawPrompt ?? original.get(run.taskId)?.prompt ?? run.prompt,
        idea?.title,
        [run.projectPath, run.workspace],
      ),
      question,
      stage:
        question ||
        run.persistenceError ||
        (!active &&
          !integratedRunIds.includes(run.id) &&
          (run.verificationError ||
            (run.verification && (!run.verification.result.success || !run.verification.tree))))
          ? 'attention'
          : integratedRunIds.includes(run.id)
            ? 'finished'
            : active
              ? 'working'
              : run.status === 'review'
                ? 'review'
                : run.status === 'reviewed'
                  ? run.workspace &&
                    run.workspace.replaceAll('\\', '/').toLowerCase() !==
                      run.projectPath.replaceAll('\\', '/').toLowerCase()
                    ? 'review'
                    : 'finished'
                  : 'attention',
      date: run.startedAt,
      idea,
      run,
      statusLabel: taskDecision(run, integratedRunIds.includes(run.id)).label,
      archiveBlocked: blocked.has(run.taskId)
        ? 'Finish or resolve all attempts and save their history first. Tasks from a conversation stay with it.'
        : undefined,
    });
  }
  return items.sort(
    (a, b) =>
      workStages.findIndex((stage) => stage.id === a.stage) -
        workStages.findIndex((stage) => stage.id === b.stage) ||
      Date.parse(b.date) - Date.parse(a.date),
  );
}

/**
 * Statuses that a row's action already says, keyed by status; the meta line leaves them out
 * when the action matches, and keeps anything that adds information.
 */
const REPEATED_STATUS: Record<string, RegExp> = {
  'ready for your review': /^(review|reply)\b/i,
  'ready to review': /^(review|reply)\b/i,
  'plan ready for review': /^review\b/i,
  'waiting for your answer': /^answer\b/i,
  'needs input': /^answer\b/i,
  'ready to merge': /^(merge|review and merge)\b/i,
};

/** The status worth showing beside the shape, unless the row's group or action already says it. */
export function workRowStatus(item: WorkItem, action: string) {
  const label = item.statusLabel?.trim();
  if (!label || item.stage === 'finished') return undefined;
  const key = label.toLowerCase();
  const group = workGroups.find((stage) => stage.id === workGroup(item.stage))?.label;
  if (key === group?.toLowerCase() || REPEATED_STATUS[key]?.test(action.trim())) return undefined;
  return label;
}

/** Whether a stage is waiting on the person, as the sidebar's Work count reads it. */
export const needsYou = (item: Pick<WorkItem, 'stage'>) =>
  item.stage === 'attention' || item.stage === 'review';

/** Most collapsible sections stay open; past this many items they start collapsed. */
export const OPEN_SECTION_LIMIT = 5;
