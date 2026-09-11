import type { TaskTicket } from '../stores/taskStore.ts';
import { type LiveSession, sessionWork } from './live-session.ts';
import type { TaskRun } from './task-runtime.ts';
import { taskTitle } from './task-title.ts';

export const workStages = [
  { id: 'attention', label: 'Needs you' },
  { id: 'review', label: 'Ready to review' },
  { id: 'working', label: 'Working' },
  { id: 'ideas', label: 'Saved ideas' },
  { id: 'finished', label: 'Finished' },
] as const;

export const ideaStageLabels: Record<TaskTicket['status'], string> = {
  backlog: 'Idea',
  refinement: 'Ready to shape',
  in_progress: 'Planned: in motion',
  verification: 'Planned: for review',
  done: 'Marked done',
};

export interface WorkItem {
  id: string;
  title: string;
  stage: (typeof workStages)[number]['id'];
  date: string;
  idea?: TaskTicket;
  run?: TaskRun;
  session?: LiveSession;
  archiveBlocked?: string;
}

export function collectWorkspaceWork(
  projectId: string | null,
  ideas: TaskTicket[],
  runs: TaskRun[],
  sessions: LiveSession[],
  integratedRunIds: string[] = [],
  archived = false,
): WorkItem[] {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const items = collectWork(
    projectId,
    ideas,
    runs.filter((run) => !run.liveSessionId || !sessionIds.has(run.liveSessionId)),
    integratedRunIds,
    archived,
  );
  if (!archived)
    for (const session of sessions) {
      if (projectId !== null && session.request.projectId !== projectId) continue;
      const work = sessionWork(session, runs);
      items.push({
        id: `session:${session.id}`,
        title: session.title,
        date: session.updatedAt,
        stage:
          work.questions.length || work.status === 'Needs attention'
            ? 'attention'
            : work.active || work.pending
              ? 'working'
              : session.closed
                ? 'finished'
                : 'review',
        run: work.latest,
        session,
        archiveBlocked: 'Chat sessions stay together. Open Chat to finish or resume it.',
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
): WorkItem[] {
  const projectRuns = runs.filter((run) => projectId === null || run.projectId === projectId);
  const byId = new Map(projectRuns.map((run) => [run.id, run]));
  const latest = new Map<string, TaskRun>();
  const original = new Map<string, TaskRun>();
  const blocked = new Set<string>();
  for (const run of projectRuns) {
    if (
      !['review', 'reviewed', 'failed', 'stopped'].includes(run.status) ||
      run.finishing ||
      run.liveSessionId ||
      run.persistenceError
    )
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
        title: idea.title,
        stage: idea.runId ? 'attention' : idea.status === 'done' ? 'finished' : 'ideas',
        date: idea.updatedAt,
        idea,
      });
    }
  }
  for (const run of latest.values()) {
    if (!!run.archivedAt !== archived) continue;
    const idea = linkedIdeas.get(run.taskId);
    const active = ['starting', 'running', 'stopping'].includes(run.status);
    const pending = active && run.prompts?.some((prompt) => prompt.status === 'pending');
    items.push({
      id: idea?.id ?? run.taskId,
      title: idea?.title ?? taskTitle(original.get(run.taskId)?.prompt ?? run.prompt),
      stage:
        pending ||
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
      archiveBlocked: blocked.has(run.taskId)
        ? 'Finish or resolve all attempts and save their history first. Chat tasks stay with their session.'
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
