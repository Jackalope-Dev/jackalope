import type { PendingUserPrompt, RunRequest } from './task-runtime';
import { nativeTask } from './task-runtime.ts';

export type PlanShape = 'single' | 'subtasks' | 'swarm';
export type PlanStatus = 'planning' | 'draft' | 'approved' | 'running' | 'done';
export type CriterionStateName =
  | 'unassessed'
  | 'agent-claimed'
  | 'check-passed'
  | 'check-failed'
  | 'human-accepted';

export interface PlanTask {
  key: string;
  title: string;
  scopes: string[];
  dependsOn: string[];
  parallel: boolean;
  covers: string[];
  briefing: string;
  status: string;
}

interface PlanCriterion {
  id: string;
  verify: 'command' | 'test' | 'browser' | 'manual';
  check: string;
  text: string;
}

export interface PlanDocument {
  front: {
    id: string;
    revision: number;
    status: string;
    sourceHead: string;
    approvedBy: string;
    approvedAt: string;
    shape: string;
    recommendedShape: string;
    shapeReason: string;
    workers: number;
  };
  title: string;
  goal: string;
  context: string;
  coverage: [string, string][];
  clarifications: { question: string; answer: string }[];
  assumptions: string[];
  outOfScope: string[];
  approach: string;
  tasks: PlanTask[];
  criteria: PlanCriterion[];
  risks: string[];
  decisionLog: string[];
  surprises: string[];
}

export interface SectionChange {
  section: string;
  change: 'added' | 'removed' | 'changed';
  before: string;
  after: string;
}

export interface TaskProgress {
  key: string;
  title: string;
  state: 'waiting' | 'running' | 'checked' | 'needs-attention' | 'merged';
  runId?: string;
  outside?: string[];
}

interface PlanDeviation {
  id: string;
  runId?: string | null;
  kind: 'declared' | 'scope' | 'criterion';
  summary: string;
  amendment: string;
  status: 'pending' | 'accepted' | 'redo' | 'replan';
  createdAt: string;
}

export interface PlanVerification {
  /** The saved project check, the plan's command and test criteria, or none. */
  source: 'project' | 'criteria' | 'review';
  command: string | null;
}

export interface PlanSettings {
  questionCap: number;
  plannerAgent?: string | null;
  plannerModel?: string | null;
  exportPath: string;
}

export interface PlanView {
  id: string;
  projectId: string;
  projectPath: string;
  title: string;
  goal: string;
  status: PlanStatus;
  planning: boolean;
  error: string | null;
  revision: number | null;
  hash: string | null;
  markdown: string | null;
  document: PlanDocument | null;
  revisions: { number: number; author: string; note: string; createdAt: string; hash: string }[];
  changes: SectionChange[];
  questions: PendingUserPrompt[];
  plannerRunId: string | null;
  approval: {
    revision: number;
    hash: string;
    sourceHead: string;
    approvedBy: string;
    approvedAt: string;
    shape: PlanShape;
    /** Empty for approvals recorded before this was saved, which used the project check. */
    verification: '' | PlanVerification['source'];
  } | null;
  shape: PlanShape;
  swarmConnected: boolean;
  progress: {
    managedTaskId: string;
    dispatching: boolean;
    error: string | null;
    repairs: number;
    repairLimit: number;
    ready: boolean;
    merged: boolean;
    tasks: TaskProgress[];
    review: TaskProgress | null;
    gaps: { severity: 'critical' | 'major' | 'minor'; text: string }[];
  } | null;
  criteria: { id: string; state: CriterionStateName; detail?: string }[];
  deviations: PlanDeviation[];
  /** How approving now would verify the work, from the project's mirrored check. */
  verification: PlanVerification;
  /** The check assembled from the plan's command and test criteria, if any. */
  criteriaCheck: string | null;
}

export interface PlanSummary {
  id: string;
  projectId: string;
  title: string;
  status: PlanStatus;
  revision: number | null;
  updatedAt: string;
  /** A deviation is waiting on the person's decision. */
  needsYou: boolean;
}

/** A plan the person wrote: tasks with instructions, scopes and outcomes. */
export interface ManualPlan {
  goal: string;
  tasks: {
    title: string;
    instructions: string;
    scopes: string[];
    /** Indexes of earlier tasks. */
    dependsOn: number[];
    outcomes: string[];
  }[];
}

export const planCommands = {
  list: (projectId?: string) =>
    nativeTask<{ plans: PlanSummary[]; problems: string[] }>('plan_list', { projectId }),
  get: (id: string) => nativeTask<PlanView>('plan_get', { id }),
  start: (request: RunRequest, goal: string) =>
    nativeTask<PlanView>('plan_start', { request, goal }),
  create: (request: RunRequest, plan: ManualPlan) =>
    nativeTask<PlanView>('plan_create', { request, plan }),
  keepPlanning: (id: string, comments: string) =>
    nativeTask<void>('plan_keep_planning', { id, comments }),
  save: (id: string, markdown: string, baseRevision: number) =>
    nativeTask<number>('plan_save', { id, markdown, baseRevision }),
  approve: (
    id: string,
    revision: number,
    hash: string,
    shape: PlanShape,
    checks?: { verifyCommand?: string; prepareCommand?: string; setupFiles?: string[] },
  ) => nativeTask<void>('plan_approve', { id, revision, hash, shape, checks }),
  replan: (id: string, comments: string) => nativeTask<void>('plan_replan', { id, comments }),
  resolveDeviation: (id: string, deviationId: string, action: 'accept' | 'redo' | 'replan') =>
    nativeTask<void>('plan_resolve_deviation', { id, deviationId, action }),
  export: (id: string, path?: string) => nativeTask<string>('plan_export', { id, path }),
  diff: (id: string, from: number, to: number) =>
    nativeTask<SectionChange[]>('plan_diff', { id, from, to }),
  revision: (id: string, number: number) => nativeTask<string>('plan_revision', { id, number }),
  archive: (id: string) => nativeTask<void>('plan_archive', { id }),
  settings: (projectId: string) => nativeTask<PlanSettings>('plan_settings_get', { projectId }),
  saveSettings: (projectId: string, settings: PlanSettings) =>
    nativeTask<void>('plan_settings_set', { projectId, settings }),
};

/** Steps of a written plan as the plan document's tasks; dependencies become indexes. */
export function manualPlan(
  goal: string,
  steps: {
    key: string;
    title: string;
    prompt: string;
    scopes: string[];
    dependsOn: string[];
    contextSelection?: { outcomes?: string[] };
  }[],
): ManualPlan {
  const index = new Map(steps.map((step, position) => [step.key, position]));
  return {
    goal: goal.trim(),
    tasks: steps.map((step) => ({
      title: step.title.trim(),
      instructions: step.prompt.trim(),
      scopes: step.scopes.map((scope) => scope.trim()).filter(Boolean),
      dependsOn: step.dependsOn.flatMap((key) => {
        const position = index.get(key);
        return position === undefined ? [] : [position];
      }),
      outcomes: (step.contextSelection?.outcomes ?? [])
        .map((outcome) => outcome.trim())
        .filter(Boolean),
    })),
  };
}

/** How approving will verify the work, given the project's current check. */
export function approvalVerification(
  view: Pick<PlanView, 'criteriaCheck'>,
  projectCheck: string | undefined,
): PlanVerification {
  if (projectCheck?.trim()) return { source: 'project', command: projectCheck.trim() };
  if (view.criteriaCheck) return { source: 'criteria', command: view.criteriaCheck };
  return { source: 'review', command: null };
}

const shapeLabels: Record<PlanShape, { label: string; detail: string }> = {
  single: { label: 'One agent', detail: 'One worker implements the plan from a fresh context.' },
  subtasks: {
    label: 'Planned subtasks',
    detail: 'Each task gets its own worker; dependencies run in order.',
  },
  swarm: { label: 'Swarm', detail: 'Planned subtasks, mirrored through your swarm Worker.' },
};

/** Shapes the person can approve, with why one is unavailable. */
export function shapeChoices(view: Pick<PlanView, 'swarmConnected' | 'document'>) {
  const open = view.document?.tasks.filter((task) => task.status !== 'done').length ?? 0;
  return (Object.keys(shapeLabels) as PlanShape[]).map((shape) => ({
    shape,
    ...shapeLabels[shape],
    unavailable:
      shape === 'swarm' && !view.swarmConnected
        ? 'Connect a swarm Worker in Settings first.'
        : shape !== 'single' && open < 2
          ? 'The plan has one task left.'
          : undefined,
  }));
}

/** Tasks in dependency waves: each wave can start once the previous one is done. */
export function taskWaves(tasks: Pick<PlanTask, 'key' | 'dependsOn'>[]) {
  const waves: string[][] = [];
  const placed = new Map<string, number>();
  let remaining = [...tasks];
  while (remaining.length) {
    const ready = remaining.filter((task) =>
      task.dependsOn.every((key) => placed.has(key) || !tasks.some((t) => t.key === key)),
    );
    if (!ready.length) {
      waves.push(remaining.map((task) => task.key));
      break;
    }
    for (const task of ready) placed.set(task.key, waves.length);
    waves.push(ready.map((task) => task.key));
    remaining = remaining.filter((task) => !placed.has(task.key));
  }
  return waves;
}

/** Each criterion with the tasks that cover it; uncovered criteria stand out. */
export function criterionCoverage(document: Pick<PlanDocument, 'tasks' | 'criteria'>) {
  return document.criteria.map((criterion) => ({
    ...criterion,
    tasks: document.tasks.filter((task) => task.covers.includes(criterion.id)).map((t) => t.key),
  }));
}

export interface PlanAssumption {
  text: string;
  /** A fact the planner confirmed by reading the code or running a read-only command. */
  checked: boolean;
  /** For a checked fact, where it was confirmed: file:line, or a command and its output. */
  evidence: string;
}

/**
 * Splits `Checked: <fact> — evidence: <where>` bullets from choices the planner made.
 * Plans saved before checked facts existed have only plain bullets and read as choices.
 */
export function planAssumption(raw: string): PlanAssumption {
  const marker = /^\s*checked:\s*/i.exec(raw);
  if (!marker) return { text: raw.trim(), checked: false, evidence: '' };
  const rest = raw.slice(marker[0].length);
  const at = rest.search(/evidence:/i);
  if (at < 0) return { text: rest.trim(), checked: true, evidence: '' };
  const before = rest.slice(0, at).replace(/[\s—–\-;,(]+$/u, '');
  let evidence = rest.slice(at + 'evidence:'.length).trim();
  if (/\(\s*$/.test(rest.slice(0, at))) evidence = evidence.replace(/\)\s*$/, '').trim();
  return { text: before.trim(), checked: true, evidence };
}

export const criterionStateLabels: Record<CriterionStateName, string> = {
  unassessed: 'Not assessed',
  'agent-claimed': 'Agent says met',
  'check-passed': 'Check passed',
  'check-failed': 'Check failed',
  'human-accepted': 'Accepted by you',
};

export const taskStateLabels: Record<TaskProgress['state'] | 'done', string> = {
  waiting: 'Waiting',
  running: 'Running',
  checked: 'Checked',
  'needs-attention': 'Needs attention',
  merged: 'Merged',
  done: 'Done earlier',
};

export function stateTone(state: string): 'success' | 'danger' | 'accent' | 'muted' {
  if (['checked', 'merged', 'done', 'check-passed', 'human-accepted'].includes(state))
    return 'success';
  if (['needs-attention', 'check-failed'].includes(state)) return 'danger';
  if (['running', 'agent-claimed'].includes(state)) return 'accent';
  return 'muted';
}

export const statusLabels: Record<PlanStatus, string> = {
  planning: 'Planning',
  draft: 'Ready to review',
  approved: 'Approved',
  running: 'Running',
  done: 'Done',
};

/** The planner's question with Jackalope's stop options shown last. */
export function interviewOptions(prompt: Pick<PendingUserPrompt, 'options' | 'recommended'>) {
  const stops = ['Use your recommendations for the rest', 'Done, draft the plan'];
  const choices = prompt.options.filter((option) => !stops.includes(option));
  return {
    choices: prompt.recommended
      ? [prompt.recommended, ...choices.filter((option) => option !== prompt.recommended)]
      : choices,
    stops: prompt.options.filter((option) => stops.includes(option)),
  };
}
