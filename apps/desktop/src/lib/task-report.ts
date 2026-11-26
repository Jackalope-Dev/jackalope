import type { ActivityKind, ActivityTime, TaskRun } from './run-types.ts';

/** The bar's groups, in the brand's fixed categorical order (series 1–4, then other). */
export type ActivityGroup = 'think' | 'read' | 'check' | 'app' | 'other';

const activityGroups: { id: ActivityGroup; label: string }[] = [
  { id: 'think', label: 'Thinking and writing' },
  { id: 'read', label: 'Reading the code' },
  { id: 'check', label: 'Tests and builds' },
  { id: 'app', label: 'Trying the app' },
  { id: 'other', label: 'Other work' },
];

const kinds: Record<Exclude<ActivityKind, 'ask'>, { label: string; group: ActivityGroup }> = {
  think: { label: 'Thinking and writing', group: 'think' },
  plan: { label: 'Planning and notes', group: 'think' },
  read: { label: 'Reading files', group: 'read' },
  search: { label: 'Searching the code', group: 'read' },
  check: { label: 'Tests and builds', group: 'check' },
  app: { label: 'Trying the app', group: 'app' },
  edit: { label: 'Editing files', group: 'other' },
  command: { label: 'Other commands', group: 'other' },
  helper: { label: 'Helper agents', group: 'other' },
  web: { label: 'Web research', group: 'other' },
  tool: { label: 'Other tools', group: 'other' },
};

/** A kind as people read it, and the bar group it belongs to. */
export function activityKind(kind: ActivityKind): { label: string; group: ActivityGroup } {
  return kind === 'ask' ? { label: 'Waiting on you', group: 'other' } : kinds[kind];
}

interface ActivityLine {
  kind: ActivityKind;
  label: string;
  group: ActivityGroup;
  wallMs: number;
  share: number;
  calls: number;
  longestMs: number;
}

export interface TimeBreakdown {
  /** False when no attempt measured its working time by activity. */
  measured: boolean;
  /** Attempts that measured it, out of `attempts`. */
  measuredAttempts: number;
  attempts: number;
  workingMs: number;
  groups: { id: ActivityGroup; label: string; ms: number; share: number }[];
  /** Every kind seen, longest first. */
  lines: ActivityLine[];
}

/** The agent's working time across attempts, by activity. Waiting on the person is left
 * out: it is the person's time, reported separately by {@link waitingMs}. */
export function timeBreakdown(runs: TaskRun[]): TimeBreakdown {
  const totals = new Map<ActivityKind, { wallMs: number; calls: number; longestMs: number }>();
  let measuredAttempts = 0;
  for (const run of runs) {
    const activity = run.efficiency?.activity;
    if (!activity || !Object.keys(activity).length) continue;
    measuredAttempts++;
    for (const [kind, time] of Object.entries(activity) as [ActivityKind, ActivityTime][]) {
      if (kind === 'ask' || !(kind in kinds)) continue;
      const total = totals.get(kind) ?? { wallMs: 0, calls: 0, longestMs: 0 };
      total.wallMs += time.wallMs;
      total.calls += time.calls;
      total.longestMs = Math.max(total.longestMs, time.longestMs);
      totals.set(kind, total);
    }
  }
  const workingMs = [...totals.values()].reduce((sum, time) => sum + time.wallMs, 0);
  const share = (ms: number) => (workingMs ? ms / workingMs : 0);
  const lines = [...totals]
    .map(([kind, time]) => ({
      kind,
      ...kinds[kind as Exclude<ActivityKind, 'ask'>],
      ...time,
      share: share(time.wallMs),
    }))
    .sort((a, b) => b.wallMs - a.wallMs || b.calls - a.calls);
  const groups = activityGroups.map(({ id, label }) => {
    const ms = lines.filter((line) => line.group === id).reduce((sum, l) => sum + l.wallMs, 0);
    return { id, label, ms, share: share(ms) };
  });
  return {
    measured: measuredAttempts > 0 && workingMs > 0,
    measuredAttempts,
    attempts: runs.length,
    workingMs,
    groups,
    lines,
  };
}

/** Time the person took to answer questions agents asked them, across attempts. */
export function waitingMs(runs: TaskRun[]) {
  let total = 0;
  for (const prompt of runs.flatMap((run) => run.prompts ?? [])) {
    if (!prompt.answeredAt || prompt.answeredBy) continue;
    const waited = Date.parse(prompt.answeredAt) - Date.parse(prompt.createdAt);
    if (Number.isFinite(waited) && waited > 0) total += waited;
  }
  return total;
}

/** Where an attempt's clock time went by Jackalope stage: setup (workspace preparation and
 * agent selection), the agent's session, and saved checks Jackalope ran. */
export function stageTotals(runs: TaskRun[]) {
  const totals = { setupMs: 0, agentMs: 0, checkMs: 0, elapsedMs: 0 };
  for (const run of runs) {
    const ended = run.endedAt ? Date.parse(run.endedAt) : Number.NaN;
    const elapsed = ended - Date.parse(run.startedAt);
    if (Number.isFinite(elapsed) && elapsed > 0) totals.elapsedMs += elapsed;
    for (const stage of run.stages ?? []) {
      const ms = stage.durationMs ?? 0;
      if (stage.stage === 'preparation' || stage.stage === 'routing') totals.setupMs += ms;
      else if (stage.stage === 'execution') totals.agentMs += ms;
      else if (stage.stage === 'verification' || stage.stage === 'verification_wait')
        totals.checkMs += ms;
    }
  }
  return totals;
}

export interface ToolUse {
  name: string;
  label: string;
  kind: ActivityKind | null;
  calls: number;
  /** Measured time across calls; null when no attempt timed this tool. */
  totalMs: number | null;
  longestMs: number | null;
}

/** Tools the agents called across attempts, the most time-consuming first. */
export function toolUse(runs: TaskRun[]): ToolUse[] {
  const tools = new Map<string, ToolUse>();
  const entry = (name: string) => {
    let tool = tools.get(name);
    if (!tool) {
      tool = { name, label: toolLabel(name), kind: null, calls: 0, totalMs: null, longestMs: null };
      tools.set(name, tool);
    }
    return tool;
  };
  for (const run of runs) {
    for (const [name, calls] of Object.entries(run.efficiency?.toolCalls ?? {})) {
      entry(name).calls += calls;
    }
    for (const [name, time] of Object.entries(run.efficiency?.toolTime ?? {})) {
      const tool = entry(name);
      tool.kind = time.kind;
      tool.totalMs = (tool.totalMs ?? 0) + time.totalMs;
      tool.longestMs = Math.max(tool.longestMs ?? 0, time.longestMs);
    }
  }
  return [...tools.values()].sort(
    (a, b) => (b.totalMs ?? -1) - (a.totalMs ?? -1) || b.calls - a.calls,
  );
}

const builtIn: Record<string, string> = {
  command_execution: 'Shell commands',
  file_change: 'File edits',
  web_search: 'Web search',
  collab_tool_call: 'Helper agents',
};
/** Jackalope's own bridge tools, by what they do for the person. */
const jackalope: Record<string, string> = {
  computer_verify: 'Saved check',
  verification_output: 'Saved check output',
  ask_user: 'Question for you',
  request_human_action: 'Request for you',
  desktop_control: 'Desktop control',
  record_decision: 'Decision log',
  record_validation_step: 'Validation step',
  restate_goal: 'Goal restatement',
};

const words = (name: string) => {
  const text = name.replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** A recorded tool name as people read it: Jackalope's own tools by name, other
 * connections as `tool (server)`. Claude names MCP tools `mcp__server__tool`; Codex
 * names them `server:tool`. */
export function toolLabel(name: string) {
  if (builtIn[name]) return builtIn[name];
  const claude = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  const [server, tool] = claude
    ? [claude[1], claude[2]]
    : name.includes(':')
      ? [name.slice(0, name.indexOf(':')), name.slice(name.indexOf(':') + 1)]
      : [null, name];
  if (!server || server === 'jackalope') return jackalope[tool] ?? words(tool);
  return `${words(tool)} (${server})`;
}

/** One sentence worth acting on, or null when nothing stands out. */
export function takeaway(time: TimeBreakdown): string | null {
  if (!time.measured || time.workingMs < 60_000) return null;
  const group = (id: ActivityGroup) => time.groups.find((g) => g.id === id)?.share ?? 0;
  const percent = (share: number) => `${Math.round(share * 100)}%`;
  if (group('check') >= 0.3)
    return `Tests and builds took ${percent(group('check'))} of the agent's time. Faster or narrower checks would shorten work like this the most.`;
  if (group('app') >= 0.25)
    return `Trying the app took ${percent(group('app'))} of the agent's time. A preview that starts faster, or fewer browser steps, would help most.`;
  if (group('read') >= 0.35)
    return `Reading the code took ${percent(group('read'))} of the agent's time. Project guidance that points at the right files can cut this.`;
  return null;
}
