import type { Project } from '../stores/projectStore.ts';
import type { LiveEntry } from './live-work.ts';
import {
  isOpenPullRequest,
  pullRequestPhaseView,
  type TrackedPullRequest,
} from './pull-requests.ts';
import type { TaskRun } from './run-types.ts';
import { hostTerms } from './source-control.ts';
import type { WorkItem } from './task-collection.ts';

/** When an item last produced something: a finished attempt, a reply or its date. */
export function workActivityTime(item: WorkItem) {
  return item.run?.endedAt ?? item.session?.updatedAt ?? item.date;
}

const time = (value: string | null | undefined) => Date.parse(value ?? '') || 0;

const itemProject = (item: WorkItem) =>
  item.run?.projectId ??
  item.session?.request.projectId ??
  item.managed?.request.projectId ??
  item.idea?.projectId;

export interface ProjectSummary {
  project: Project;
  running: number;
  /** Waiting on the person: questions, failures and stopped work. */
  needsYou: number;
  reviewReady: number;
  drafts: number;
  lastActivity?: string;
  /** Where finished work merges; plain folders have none. */
  targetBranch?: string;
  pullRequests: { pullRequest: TrackedPullRequest; item?: WorkItem }[];
  /** The newest project check any attempt ran. */
  lastCheck?: { success: boolean; at: string; command: string; item?: WorkItem };
  previews: { runId: string; port: number; item?: WorkItem }[];
}

interface SummaryInput {
  projects: Project[];
  items: WorkItem[];
  live: LiveEntry[];
  runs: TaskRun[];
  pullRequests: Record<string, TrackedPullRequest>;
  /** Running previews by attempt. */
  previews: Record<string, number>;
}

/** How urgently a project wants a look: the sort key for the Projects section. */
function urgency(summary: ProjectSummary) {
  const failingPullRequests = summary.pullRequests.filter(({ pullRequest }) =>
    ['failing', 'changes', 'conflict'].includes(pullRequest.phase),
  ).length;
  return (
    summary.needsYou * 1000 +
    failingPullRequests * 500 +
    (summary.lastCheck && !summary.lastCheck.success ? 300 : 0) +
    summary.reviewReady * 100 +
    summary.running * 10
  );
}

/** One summary per project, the ones that need attention first, then the most recently active. */
export function projectSummaries({
  projects,
  items,
  live,
  runs,
  pullRequests,
  previews,
}: SummaryInput): ProjectSummary[] {
  const runProject = new Map(runs.map((run) => [run.id, run.projectId]));
  const itemForRun = (runId: string) => {
    const run = runs.find((entry) => entry.id === runId);
    return items.find(
      (item) => item.run?.id === runId || (!!run && item.run?.taskId === run.taskId),
    );
  };
  const summaries = projects.map((project): ProjectSummary => {
    const own = items.filter((item) => itemProject(item) === project.id);
    const ownRuns = runs.filter((run) => run.projectId === project.id);
    const activity = [
      ...own.filter((item) => item.stage !== 'ideas').map(workActivityTime),
      ...live.filter((entry) => entry.projectId === project.id).map((entry) => entry.since),
    ].sort((a, b) => time(b) - time(a));
    const checked = ownRuns
      .flatMap((run) =>
        run.verification
          ? [{ run, success: run.verification.result.success, at: run.verification.checkedAt }]
          : run.verificationError && run.endedAt
            ? [{ run, success: false, at: run.endedAt }]
            : [],
      )
      .sort((a, b) => time(b.at) - time(a.at))[0];
    return {
      project,
      running: live.filter((entry) => entry.projectId === project.id && !entry.waiting).length,
      needsYou: own.filter((item) => item.stage === 'attention').length,
      reviewReady: own.filter((item) => item.stage === 'review').length,
      drafts: own.filter((item) => item.stage === 'ideas').length,
      lastActivity: activity[0],
      targetBranch: project.plainFolder
        ? undefined
        : project.preferences?.baseBranch || project.gitBranch || undefined,
      pullRequests: Object.values(pullRequests)
        .filter((pr) => isOpenPullRequest(pr) && runProject.get(pr.runId) === project.id)
        .sort((a, b) => (b.number ?? 0) - (a.number ?? 0))
        .map((pullRequest) => ({ pullRequest, item: itemForRun(pullRequest.runId) })),
      lastCheck: checked && {
        success: checked.success,
        at: checked.at,
        command: checked.run.verification?.command ?? checked.run.verifyCommand ?? '',
        item: itemForRun(checked.run.id),
      },
      previews: Object.entries(previews)
        .filter(([runId]) => runProject.get(runId) === project.id)
        .map(([runId, port]) => ({ runId, port, item: itemForRun(runId) })),
    };
  });
  return summaries.sort(
    (a, b) =>
      urgency(b) - urgency(a) ||
      time(b.lastActivity) - time(a.lastActivity) ||
      a.project.name.localeCompare(b.project.name),
  );
}

/** What a finished item ended as, in a few words. */
export function finishedOutcome(item: WorkItem, mergedRunIds: string[]) {
  if (item.pullRequest?.phase === 'merged')
    return `${hostTerms(item.pullRequest.provider).Noun} merged`;
  if (item.run && mergedRunIds.includes(item.run.id)) return 'Merged';
  if (item.session?.integratedRunId) return 'Merged';
  if (item.stage === 'inReview' && item.pullRequest)
    return pullRequestPhaseView(item.pullRequest.phase, item.pullRequest.provider).label;
  if (item.stage === 'review') return 'Ready to review';
  return 'Finished';
}

/** The last few completed or merged items, newest first. */
export function recentlyFinished(items: WorkItem[], limit = 6) {
  return items
    .filter(
      (item) =>
        ['finished', 'review', 'inReview'].includes(item.stage) &&
        !!(item.run?.endedAt || item.session),
    )
    .sort((a, b) => time(workActivityTime(b)) - time(workActivityTime(a)))
    .slice(0, limit);
}
