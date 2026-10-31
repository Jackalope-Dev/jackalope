import { sessionWork } from './live-session.ts';
import { managedTaskWork } from './managed-task.ts';
import type { QueueView } from './queue.ts';
import { capturedPages } from './review-captures.ts';
import type { WorkItem } from './task-collection.ts';
import { requirementAssessment } from './task-outcomes.ts';
import type { PendingUserPrompt, ScreenshotArtifact, TaskRun } from './task-runtime.ts';
import { looksLikePlan, taskDecision } from './task-workflow.ts';
import { signalKey } from './work-signals.ts';

/** How long without input or focus before a return counts as coming back. */
export const AWAY_THRESHOLD_MS = 15 * 60_000;

/**
 * When the person left, if the gap since they were last present is long enough to
 * count as being away; otherwise null. A missing or unreadable time means a first run.
 */
export function awaySince(
  lastPresent: string | null | undefined,
  now: number,
  threshold = AWAY_THRESHOLD_MS,
): string | null {
  const time = lastPresent ? Date.parse(lastPresent) : Number.NaN;
  if (!Number.isFinite(time) || now - time < threshold) return null;
  return new Date(time).toISOString();
}

export type CatchUpRisk = 'low' | 'medium' | 'high' | 'unknown';

export interface CatchUpPicture {
  runId: string;
  image: ScreenshotArtifact;
}

/** One line about something that finished or failed while the person was away. */
export interface CatchUpEvent {
  item: WorkItem;
  title: string;
  outcome: string;
  tone: 'success' | 'warning' | 'default';
  detail?: string;
  project?: string;
  picture?: CatchUpPicture;
}

/** One call only the person can make, with what they need to make it. */
export interface CatchUpDecision {
  item: WorkItem;
  kind: 'recovery' | 'question' | 'failed-check' | 'stopped' | 'paused' | 'review' | 'other';
  title: string;
  decision: string;
  changes: string;
  evidence: string[];
  risk: { level: CatchUpRisk; reason: string };
  suggestion?: string;
  action: string;
  project?: string;
}

export interface CatchUp {
  since: string;
  headline: string;
  happened: CatchUpEvent[];
  /** Finished items past the summary limit; they stay in the Work list. */
  moreHappened: number;
  waiting: CatchUpDecision[];
}

export interface CatchUpInput {
  items: WorkItem[];
  runs: TaskRun[];
  queue?: QueueView;
  since: string;
  /** Last visit per work item, keyed like the Work list's read state. */
  seen?: Record<string, string>;
  /** Changed-file counts per attempt, when Jackalope has read them. */
  changedFiles?: Record<string, number>;
  /** How workPresence names the item's next action. */
  actionFor: (item: WorkItem) => string;
}

const HAPPENED_LIMIT = 6;

function itemRuns(item: WorkItem, runs: TaskRun[], queue?: QueueView): TaskRun[] {
  if (item.managed && queue) return managedTaskWork(item.managed, queue, runs).work;
  if (item.session) return sessionWork(item.session, runs).work;
  return item.run ? [item.run] : [];
}

function pendingQuestions(item: WorkItem, runs: TaskRun[], queue?: QueueView) {
  return itemRuns(item, runs, queue).flatMap((run) =>
    (run.prompts ?? []).filter((prompt) => prompt.status === 'pending'),
  );
}

/** The newest moment the item produced something the person would want to know. */
function changedAt(item: WorkItem, runs: TaskRun[], queue?: QueueView): string {
  const times = [item.session?.error ? item.session.updatedAt : undefined];
  for (const run of itemRuns(item, runs, queue)) {
    times.push(run.endedAt ?? undefined, run.verification?.checkedAt);
    for (const prompt of run.prompts ?? [])
      if (prompt.status === 'pending') times.push(prompt.createdAt);
  }
  const valid = times.filter((time): time is string => !!time && Number.isFinite(Date.parse(time)));
  if (!valid.length) return item.date;
  return new Date(Math.max(...valid.map((time) => Date.parse(time)))).toISOString();
}

function isolated(run: TaskRun | undefined) {
  return (
    !!run?.workspace &&
    run.workspace.replaceAll('\\', '/').toLowerCase() !==
      run.projectPath.replaceAll('\\', '/').toLowerCase()
  );
}

function inProjectFolder(run: TaskRun | undefined) {
  return !!run?.workspace && !isolated(run);
}

const pathLike = /(?:[A-Za-z]:\\|\\\\|\/[\w.-]+\/|\b[\w-]+\/[\w./-]+\.\w{1,6}\b)/;
const hashLike = /\b[0-9a-f]{7,40}\b/i;

/**
 * The first plain sentence of an agent's result, without Markdown, paths or hashes,
 * short enough to read at a glance. Undefined when the result has none.
 */
export function plainSummary(text: string | null | undefined, limit = 140): string | undefined {
  if (!text) return undefined;
  let fenced = false;
  for (const raw of text.slice(0, 8000).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line || line.startsWith('|') || line.startsWith('>') || /^-{3,}$/.test(line))
      continue;
    const heading = /^#{1,6}\s/.test(line);
    const cleaned = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // Short headings such as "Summary" or "Changes" label a section rather than say anything.
    if (heading && cleaned.split(' ').length < 4) continue;
    if (/^[\w ]{1,24}:$/.test(cleaned)) continue;
    const sentence = cleaned.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? cleaned;
    if (sentence.length < 12 || pathLike.test(sentence) || hashLike.test(sentence)) continue;
    if (sentence.length <= limit) return sentence;
    const cut = sentence.slice(0, limit - 1);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), limit / 2)).trimEnd()}…`;
  }
  return undefined;
}

function firstLine(text: string | null | undefined, limit = 120) {
  const line = text
    ?.split(/\r?\n/)
    .find((part) => part.trim())
    ?.trim();
  if (!line) return undefined;
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}

function picture(run: TaskRun | undefined): CatchUpPicture | undefined {
  if (!run) return undefined;
  const page = capturedPages(run.reviewCaptures)[0];
  const image = page?.after ?? page?.before ?? run.screenshots?.at(-1);
  return image ? { runId: run.id, image } : undefined;
}

function checksEvidence(run: TaskRun) {
  if (run.verificationError) return 'Project checks could not finish';
  const result = run.verification?.result;
  if (!result) return 'No project checks ran';
  if (result.timedOut) return 'Project checks timed out';
  if (!result.success) return 'Project checks failed';
  return run.verification?.tree
    ? 'Project checks passed'
    : 'Project checks passed on an earlier version of the changes';
}

function checksPassed(run: TaskRun | undefined) {
  return !!run?.verification?.result.success && !!run.verification.tree && !run.verificationError;
}

function checksFailed(run: TaskRun | undefined) {
  return !!run && (!!run.verificationError || run.verification?.result.success === false);
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** What Jackalope recorded about the attempt, in plain words. */
function evidenceFor(run: TaskRun | undefined, changedFiles?: number): string[] {
  if (!run) return ['No attempt recorded yet'];
  const evidence = [checksEvidence(run)];
  const requirements = run.contract?.requirements ?? [];
  if (requirements.length) {
    const met = requirements.filter(
      (item) => requirementAssessment(run.validationSteps, item.id)?.answer.status === 'met',
    ).length;
    const accepted = requirements.filter((item) => item.receipt?.accepted).length;
    evidence.push(`The agent reports ${met} of ${plural(requirements.length, 'outcome')} met`);
    if (accepted) evidence.push(`You accepted ${accepted} of ${requirements.length}`);
  }
  const pages = capturedPages(run.reviewCaptures).length;
  if (pages)
    evidence.push(
      run.reviewCaptures?.beforeAvailable
        ? `Before and after screenshots of ${plural(pages, 'page')}`
        : `Screenshots of ${plural(pages, 'page')}`,
    );
  else if (run.reviewCapturing) evidence.push('Screenshots are still being taken');
  const shots = run.screenshots?.length ?? 0;
  if (shots) evidence.push(`${plural(shots, 'screenshot')} from the agent`);
  if (changedFiles !== undefined)
    evidence.push(changedFiles ? `${plural(changedFiles, 'file')} changed` : 'No files changed');
  return evidence;
}

function quoted(text: string, limit = 200) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}

function decisionFor(
  item: WorkItem,
  questions: PendingUserPrompt[],
  changedFiles: number | undefined,
): Omit<CatchUpDecision, 'item' | 'title' | 'action' | 'project'> {
  const run = item.run;
  const target = run?.targetBranch?.trim() || 'your project';
  const ownCopy = isolated(run);
  if (run?.persistenceError)
    return {
      kind: 'recovery',
      decision: 'Recover this work so its history is saved.',
      changes: 'Recovering saves the record of what the agent did, so the work can continue.',
      evidence: [firstLine(run.persistenceError) ?? 'Saving its history failed'],
      risk: { level: 'high', reason: 'Its history is not saved yet.' },
      suggestion: 'Recover the saved history first.',
    };
  if (questions.length) {
    const question = questions[0];
    const more = questions.length - 1;
    return {
      kind: 'question',
      decision: `Answer: “${quoted(question.question)}”${more ? ` (and ${plural(more, 'more question')})` : ''}`,
      changes: 'Your answer decides how the agent continues.',
      evidence: [
        question.options.length
          ? `It offers ${plural(question.options.length, 'choice')}`
          : 'It asks for a written answer',
        ...(question.rationale ? [`Why it asks: ${quoted(question.rationale, 160)}`] : []),
      ],
      risk: inProjectFolder(run)
        ? { level: 'medium', reason: 'The agent works directly in your project folder.' }
        : { level: 'low', reason: 'Your project stays unchanged until you review the result.' },
      suggestion: question.recommended
        ? `Answer “${quoted(question.recommended, 80)}”, which the agent recommends.`
        : undefined,
    };
  }
  if (checksFailed(run) && run && !['failed', 'stopped', 'interrupted'].includes(run.status))
    return {
      kind: 'failed-check',
      decision: 'The project checks fail. Ask for a fix, or inspect the changes yourself.',
      changes: 'A follow-up starts a new attempt on the same work.',
      evidence: evidenceFor(run, changedFiles),
      risk: run.verificationError
        ? { level: 'unknown', reason: 'The checks could not finish, so nothing is confirmed.' }
        : { level: 'high', reason: 'The project checks fail with these changes.' },
    };
  const managed = item.managed;
  if (managed && item.statusLabel === 'Paused')
    return {
      kind: 'paused',
      decision: 'This planned task is paused. Resume it or leave it paused.',
      changes: 'Resuming lets its remaining tasks start.',
      evidence: evidenceFor(run, changedFiles),
      risk: { level: 'low', reason: 'Nothing runs while it is paused.' },
    };
  const stopped =
    (run && ['failed', 'stopped', 'interrupted'].includes(run.status)) ||
    !!item.session?.error ||
    !!managed?.error ||
    item.statusLabel === 'Needs attention';
  if (stopped && item.stage === 'attention') {
    const error = firstLine(item.session?.error ?? managed?.error ?? run?.error);
    return {
      kind: 'stopped',
      decision: `It stopped before finishing. Retry it, continue it or set it aside.`,
      changes: 'Retrying starts a new attempt; the earlier work stays available.',
      evidence: [...(error ? [`Last error: ${error}`] : []), ...evidenceFor(run, changedFiles)],
      risk: inProjectFolder(run)
        ? { level: 'medium', reason: 'It may have left partial changes in your project folder.' }
        : { level: 'low', reason: 'Nothing was merged into your project.' },
    };
  }
  if (item.stage === 'review' && run) {
    const plan = looksLikePlan(run.result);
    const passed = checksPassed(run);
    const rejected = run.contract?.requirements.some((req) => req.receipt?.accepted === false);
    const decision = plan
      ? 'Decide whether to go ahead with this plan.'
      : changedFiles === 0
        ? 'Read the result and decide whether it answers your request.'
        : run.status === 'reviewed' && ownCopy
          ? `You reviewed it. Decide whether to merge it into ${target}.`
          : ownCopy
            ? `Decide whether to merge these changes into ${target}.`
            : 'Decide whether to keep these changes.';
    const changes = plan
      ? 'Going ahead starts the work it describes.'
      : changedFiles === 0
        ? 'No files change.'
        : ownCopy
          ? `Merging adds its changes to ${target}.`
          : 'The changes are already in your project folder.';
    const risk: CatchUpDecision['risk'] =
      plan || changedFiles === 0
        ? { level: 'low', reason: 'No files change.' }
        : rejected
          ? { level: 'medium', reason: 'You marked an outcome as needing changes.' }
          : !run.verification && !run.verificationError
            ? { level: 'unknown', reason: 'No project checks ran on these changes.' }
            : passed
              ? ownCopy
                ? { level: 'low', reason: 'Checks pass, and nothing merges until you choose.' }
                : { level: 'low', reason: 'Checks pass on the changes in your project folder.' }
              : {
                  level: 'medium',
                  reason: 'The checks did not run on the latest version of the changes.',
                };
    const suggestion =
      plan && passed
        ? 'Read the plan, then decide whether to start it.'
        : passed && !rejected && ownCopy
          ? run.status === 'reviewed'
            ? `Merge into ${target}.`
            : 'Review the changes, then merge them.'
          : undefined;
    return {
      kind: 'review',
      decision,
      changes,
      evidence: evidenceFor(run, changedFiles),
      risk,
      suggestion,
    };
  }
  return {
    kind: 'other',
    decision: run
      ? `${taskDecision(run).label}. Open it to decide what happens next.`
      : 'Open it to decide what happens next.',
    changes: 'Nothing changes until you act.',
    evidence: evidenceFor(run, changedFiles),
    risk: { level: 'unknown', reason: 'Jackalope has no check result for it.' },
  };
}

function eventFor(
  item: WorkItem,
  runs: TaskRun[],
  queue?: QueueView,
): Omit<CatchUpEvent, 'project'> | undefined {
  const run = item.run;
  const base = { item, title: item.title, picture: picture(run) };
  const summary = plainSummary(run?.result);
  if (item.stage === 'finished') {
    if (item.session?.closed && !item.session.integratedRunId)
      return { ...base, outcome: 'Finished', tone: 'success', detail: summary };
    return { ...base, outcome: 'Merged into your project', tone: 'success', detail: summary };
  }
  if (item.stage === 'review')
    return { ...base, outcome: 'Ready for your review', tone: 'success', detail: summary };
  if (item.stage !== 'attention') return undefined;
  // A question is a call, not an outcome; it appears only with the waiting items.
  if (pendingQuestions(item, runs, queue).length) return undefined;
  if (run?.persistenceError)
    return { ...base, outcome: 'Finished, but its history did not save', tone: 'warning' };
  if (checksFailed(run) && run && !['failed', 'stopped', 'interrupted'].includes(run.status))
    return {
      ...base,
      outcome: run.verificationError
        ? 'Finished, but the checks could not finish'
        : 'Finished, but the project checks fail',
      tone: 'warning',
      detail: summary,
    };
  if (run?.status === 'interrupted')
    return { ...base, outcome: 'Interrupted before finishing', tone: 'warning' };
  if (run?.status === 'stopped')
    return { ...base, outcome: 'Stopped before finishing', tone: 'warning' };
  const error = firstLine(item.session?.error ?? item.managed?.error ?? run?.error);
  if (error || run?.status === 'failed' || item.statusLabel === 'Needs attention')
    return {
      ...base,
      outcome: error ? `Failed: ${error}` : 'Stopped with a problem',
      tone: 'warning',
    };
  return undefined;
}

function projectOf(item: WorkItem) {
  return (
    item.run?.projectName ?? item.session?.request.projectName ?? item.managed?.request.projectName
  );
}

const kindPriority: Record<CatchUpDecision['kind'], number> = {
  recovery: 0,
  question: 1,
  'failed-check': 2,
  stopped: 3,
  paused: 4,
  other: 5,
  review: 6,
};

const kindNames: Record<CatchUpDecision['kind'], [string, string]> = {
  recovery: ['a recovery', 'recoveries'],
  question: ['a question', 'questions'],
  'failed-check': ['a failed check', 'failed checks'],
  stopped: ['a stopped task', 'stopped tasks'],
  paused: ['a paused plan', 'paused plans'],
  review: ['a review', 'reviews'],
  other: ['another item', 'other items'],
};

/** One sentence naming what waits on the person, or saying nothing does. */
export function catchUpHeadline(waiting: CatchUpDecision[]): string {
  if (!waiting.length) return 'Nothing needs you right now.';
  if (waiting.length === 1) {
    const [only] = waiting;
    const verb =
      only.kind === 'question'
        ? 'has a question for you'
        : only.kind === 'review'
          ? 'is ready for your review'
          : 'needs you';
    return `“${only.title}” ${verb}.`;
  }
  const counts = new Map<CatchUpDecision['kind'], number>();
  for (const item of waiting) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, count]) =>
    count === 1 ? kindNames[kind][0] : `${count} ${kindNames[kind][1]}`,
  );
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `${waiting.length} things need you: ${list}.`;
}

/**
 * What happened while the person was away and every call waiting on them, built
 * only from recorded task, check, question and capture data. Null when nothing
 * changed since they left, so the summary stays out of the way.
 */
export function buildCatchUp({
  items,
  runs,
  queue,
  since,
  seen = {},
  changedFiles = {},
  actionFor,
}: CatchUpInput): CatchUp | null {
  const live = items.filter((item) => item.run || item.session || item.managed);
  const changed = new Map(live.map((item) => [item.id, changedAt(item, runs, queue)]));
  const isNew = (item: WorkItem) => {
    const time = changed.get(item.id) ?? item.date;
    const visited = seen[signalKey(item)];
    return time > since && (!visited || visited < time);
  };
  const projects = new Set(live.map(projectOf).filter(Boolean));
  const project = (item: WorkItem) => (projects.size > 1 ? projectOf(item) : undefined);

  const waiting = live
    .filter((item) => item.stage === 'attention' || item.stage === 'review')
    .map((item): CatchUpDecision => {
      const files = item.run ? changedFiles[item.run.id] : undefined;
      const decision = decisionFor(item, pendingQuestions(item, runs, queue), files);
      return {
        item,
        title: item.title,
        // A failing result keeps its review label in the list; here it would invite a merge.
        action:
          decision.kind === 'failed-check'
            ? item.session
              ? 'Open conversation'
              : 'Open task'
            : actionFor(item),
        project: project(item),
        ...decision,
      };
    })
    .sort(
      (a, b) =>
        kindPriority[a.kind] - kindPriority[b.kind] ||
        Date.parse(a.item.date) - Date.parse(b.item.date),
    );

  const events = live
    .filter(isNew)
    .sort((a, b) => (changed.get(b.id) ?? '').localeCompare(changed.get(a.id) ?? ''))
    .flatMap((item) => {
      const event = eventFor(item, runs, queue);
      return event ? [{ ...event, project: project(item) }] : [];
    });
  // Pictures lead, so results with screenshots come first.
  const ordered = [
    ...events.filter((event) => event.picture),
    ...events.filter((event) => !event.picture),
  ];

  if (!ordered.length && !waiting.some((decision) => isNew(decision.item))) return null;
  return {
    since,
    headline: catchUpHeadline(waiting),
    happened: ordered.slice(0, HAPPENED_LIMIT),
    moreHappened: Math.max(0, ordered.length - HAPPENED_LIMIT),
    waiting,
  };
}
