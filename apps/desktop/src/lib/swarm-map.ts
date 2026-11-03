import type { QueueView } from './queue';
import type { SwarmConflict, SwarmFile } from './swarm';
import type { TaskRun } from './task-runtime';
import { taskTitle } from './task-title.ts';

/** Where one piece of work sits on its way to the target branch. */
export type SwarmPhase = 'queued' | 'working' | 'checking' | 'ready' | 'attention' | 'merged';

export const SWARM_PHASES: { phase: SwarmPhase; label: string }[] = [
  { phase: 'queued', label: 'Queued' },
  { phase: 'working', label: 'Working' },
  { phase: 'checking', label: 'Checking' },
  { phase: 'ready', label: 'Ready' },
  { phase: 'attention', label: 'Needs you' },
  { phase: 'merged', label: 'Merged' },
];

export interface SwarmAgent {
  id: string;
  /** The attempt to open; queued work has none yet. */
  runId: string | null;
  title: string;
  agent: string;
  phase: SwarmPhase;
  /** What is happening now, or why the work needs a person. */
  detail: string;
  /** The planned task this work belongs to. */
  plan: string | null;
  files: string[];
  /** Files reported only partially by the swarm Worker. */
  truncated: boolean;
  conflicts: number;
  since: string;
}

interface SwarmHotFile {
  path: string;
  agents: string[];
  conflicted: boolean;
}

interface SwarmLink {
  from: string;
  to: string;
  path: string;
}

export interface SwarmMapModel {
  agents: SwarmAgent[];
  /** Files more than one agent is changing. */
  hotFiles: SwarmHotFile[];
  /** Conflicts between two agents, by agent id. */
  links: SwarmLink[];
  counts: Record<SwarmPhase, number>;
}

interface SwarmForkInput {
  fork: string;
  attemptId: string;
  title?: string;
  files: SwarmFile[];
  truncated: boolean;
  error: string | null;
}

const ACTIVE = new Set(['starting', 'running', 'stopping']);
const RECENT_MS = 24 * 60 * 60 * 1000;
const MERGED_SHOWN = 6;

/**
 * One node per task on the project: the latest attempt of each task that is
 * working, waiting for a merge or a person, plus recent merges so the map shows
 * the stream reaching the target branch, and queued planned work.
 */
export function swarmMap({
  projectId,
  runs,
  queue,
  forks = [],
  conflicts = [],
  now = Date.now(),
}: {
  projectId: string;
  runs: TaskRun[];
  queue: QueueView;
  forks?: SwarmForkInput[];
  conflicts?: SwarmConflict[];
  now?: number;
}): SwarmMapModel {
  const merged = new Set(queue.mergedRunIds);
  const items = queue.items.filter((item) => item.projectId === projectId);
  const plans = new Map((queue.managedTasks ?? []).map((task) => [task.id, task]));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const planOfTask = new Map<string, string>();
  for (const item of items) {
    const run = item.runId ? runsById.get(item.runId) : undefined;
    const plan = item.featureId ? plans.get(item.featureId)?.title : item.feature;
    if (run && plan) planOfTask.set(run.taskId, plan);
  }
  const held = new Map<string, string>();
  for (const job of queue.reconciliations ?? [])
    if (job.projectId === projectId && job.held && job.runId) held.set(job.runId, job.held);
  for (const task of plans.values()) {
    const reason = task.delivery?.held;
    if (!reason || task.delivery?.appliedAt) continue;
    for (const item of items)
      if (item.featureId === task.id && item.runId) held.set(item.runId, reason);
  }

  const latest = new Map<string, TaskRun>();
  for (const run of runs) {
    if (run.projectId !== projectId || run.archivedAt || run.challengeOf) continue;
    const prior = latest.get(run.taskId);
    if (!prior || prior.startedAt < run.startedAt) latest.set(run.taskId, run);
  }
  const forkByRun = new Map(forks.map((fork) => [fork.attemptId, fork]));
  const runOfFork = new Map(forks.map((fork) => [fork.fork, fork.attemptId]));

  const agents: SwarmAgent[] = [];
  const mergedAgents: SwarmAgent[] = [];
  for (const run of latest.values()) {
    const fork = forkByRun.get(run.id);
    const { phase, detail } = phaseOf(run, merged, held);
    const since = run.endedAt ?? run.startedAt;
    if (!ACTIVE.has(run.status) && now - Date.parse(since) > RECENT_MS && phase !== 'ready')
      continue;
    const agent: SwarmAgent = {
      id: run.id,
      runId: run.id,
      title: fork?.title || taskTitle(run.prompt),
      agent: run.agent,
      phase,
      detail,
      plan: planOfTask.get(run.taskId) ?? null,
      files: fork && !fork.error ? fork.files.map((file) => file.path) : [],
      truncated: fork?.truncated ?? false,
      conflicts: 0,
      since,
    };
    (phase === 'merged' ? mergedAgents : agents).push(agent);
  }
  mergedAgents.sort((a, b) => b.since.localeCompare(a.since));
  agents.push(...mergedAgents.slice(0, MERGED_SHOWN));
  for (const item of items) {
    if (item.runId || item.canceled || item.error) continue;
    agents.push({
      id: `item:${item.id}`,
      runId: null,
      title: item.title,
      agent: item.agent,
      phase: 'queued',
      detail: item.dependencies.length ? 'Waiting for the work it depends on' : 'Waiting to start',
      plan: item.featureId ? (plans.get(item.featureId)?.title ?? null) : (item.feature ?? null),
      files: item.scopes,
      truncated: false,
      conflicts: 0,
      since: '',
    });
  }
  // Earlier work first, so nodes keep their place on the map as it updates.
  const order: SwarmPhase[] = SWARM_PHASES.map(({ phase }) => phase);
  agents.sort(
    (a, b) =>
      (a.since || '~').localeCompare(b.since || '~') ||
      order.indexOf(a.phase) - order.indexOf(b.phase),
  );

  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const links: SwarmLink[] = [];
  const conflictedPaths = new Set<string>();
  for (const conflict of conflicts) {
    const [from, to] = conflict.forks.map((fork) => runOfFork.get(fork) ?? '');
    const left = byId.get(from);
    const right = byId.get(to);
    if (!left || !right) continue;
    links.push({ from, to, path: conflict.path });
    left.conflicts += 1;
    right.conflicts += 1;
    conflictedPaths.add(conflict.path);
  }

  const touching = new Map<string, string[]>();
  for (const agent of agents) {
    if (agent.phase === 'queued' || agent.phase === 'merged') continue;
    for (const path of agent.files) touching.set(path, [...(touching.get(path) ?? []), agent.id]);
  }
  const hotFiles = [...touching]
    .filter(([, ids]) => ids.length > 1)
    .map(([path, ids]) => ({ path, agents: ids, conflicted: conflictedPaths.has(path) }))
    .sort(
      (a, b) => Number(b.conflicted) - Number(a.conflicted) || b.agents.length - a.agents.length,
    );

  const counts = Object.fromEntries(order.map((phase) => [phase, 0])) as Record<SwarmPhase, number>;
  for (const agent of agents) counts[agent.phase] += 1;
  return { agents, hotFiles, links, counts };
}

function phaseOf(
  run: TaskRun,
  merged: Set<string>,
  held: Map<string, string>,
): { phase: SwarmPhase; detail: string } {
  const question = run.prompts?.find((prompt) => prompt.status === 'pending');
  if (question) return { phase: 'attention', detail: `Asks: ${question.question}` };
  if (ACTIVE.has(run.status)) {
    if (run.finishing || run.progress?.step === 'verification')
      return { phase: 'checking', detail: run.progress?.detail || 'Running the project checks' };
    return {
      phase: 'working',
      detail: run.progress?.detail || run.progress?.label || 'Working',
    };
  }
  if (merged.has(run.id)) return { phase: 'merged', detail: 'Merged into the target branch' };
  if (run.status === 'review' || run.status === 'reviewed') {
    if (run.verificationError || (run.verification && !run.verification.result.success))
      return { phase: 'attention', detail: 'Checks failed' };
    if (!run.verification?.tree) return { phase: 'attention', detail: 'Not checked yet' };
    const reason = held.get(run.id);
    if (reason) return { phase: 'attention', detail: reason };
    return { phase: 'ready', detail: 'Checks passed; ready to merge' };
  }
  if (run.status === 'failed')
    return { phase: 'attention', detail: run.error || 'The agent stopped with an error' };
  return { phase: 'attention', detail: 'Stopped before finishing' };
}
