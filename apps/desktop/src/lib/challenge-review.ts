import type { TaskRun } from './task-runtime';

export interface ChallengeFinding {
  title: string;
  command: string;
  output: string;
  expected: string;
  breaks: string;
}

/** What one Challenge reviewer reported. */
export interface ReviewerReport {
  /** Findings proven by a command and its printed output. */
  proven: ChallengeFinding[];
  /** Findings reported without a command or without what it printed. */
  dropped: number;
  /** False when the reviewer reported neither through the tool nor in a findings block. */
  structured: boolean;
}

export interface MergedFinding extends ChallengeFinding {
  key: string;
  /** Every reviewer that proved this root cause, first finder first. */
  sources: { runId: string; agent: string; workspace: string }[];
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function finding(value: Record<string, unknown>, title?: string): ChallengeFinding {
  return {
    title: text(title ?? value.title) || text(value.command) || 'Untitled finding',
    command: text(value.command),
    output: text(value.output),
    expected: text(value.expected),
    breaks: text(value.breaks ?? value.breaksIntent),
  };
}

/** The reviewer reply's jackalope-findings block, or undefined when it has none or it is invalid. */
export function findingsBlock(reply: string): ChallengeFinding[] | undefined {
  const start = reply.lastIndexOf('```jackalope-findings');
  if (start < 0) return;
  const body = reply.slice(start + '```jackalope-findings'.length);
  const end = body.indexOf('```');
  try {
    const items: unknown = JSON.parse(end < 0 ? body : body.slice(0, end));
    if (!Array.isArray(items)) return;
    return items
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => finding(item));
  } catch {
    return;
  }
}

const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

/** Reads a reviewer's findings from its recorded steps and, as a fallback, its reply. */
export function reviewerReport(run: Pick<TaskRun, 'validationSteps'>, reply = ''): ReviewerReport {
  const proven: ChallengeFinding[] = [];
  let dropped = 0;
  const seen: ChallengeFinding[] = [];
  // The block usually repeats what the tool recorded, so it only adds new root causes.
  const add = (item: ChallengeFinding, failed: boolean) => {
    if (seen.some((earlier) => sameRootCause(earlier, item))) return;
    seen.push(item);
    if (!item.command || !item.output) dropped += 1;
    else if (failed) proven.push(item);
  };
  const recorded = (run.validationSteps ?? []).filter((step) => step.finding);
  for (const step of recorded)
    add(finding({ ...step.finding }, step.step), step.status === 'failed');
  const block = findingsBlock(reply);
  for (const item of block ?? []) add(item, true);
  return { proven, dropped, structured: recorded.length > 0 || !!block };
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'when', 'not', 'are', 'its', 'but']);
const words = (value: string) =>
  new Set(
    normalized(value)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );

function similarity(a: string, b: string) {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / (left.size + right.size - shared);
}

const firstLine = (value: string) =>
  normalized(value.split('\n').find((line) => line.trim()) ?? '');

/**
 * Two findings share a root cause when they ran the same command and it failed the
 * same way, or when their titles describe the same failure.
 */
function sameRootCause(a: ChallengeFinding, b: ChallengeFinding) {
  return (
    (!!a.command &&
      normalized(a.command) === normalized(b.command) &&
      firstLine(a.output) === firstLine(b.output)) ||
    similarity(a.title, b.title) >= 0.6
  );
}

/** Merges reviewers' proven findings, crediting every reviewer that found a root cause. */
export function mergeFindings(
  reports: { run: Pick<TaskRun, 'id' | 'agent' | 'workspace'>; report: ReviewerReport }[],
): MergedFinding[] {
  const merged: MergedFinding[] = [];
  for (const { run, report } of reports)
    for (const item of report.proven) {
      const source = { runId: run.id, agent: run.agent, workspace: run.workspace };
      const match = merged.find((existing) => sameRootCause(existing, item));
      if (!match) merged.push({ ...item, key: `${run.id}:${merged.length}`, sources: [source] });
      else if (!match.sources.some((existing) => existing.runId === run.id))
        match.sources.push(source);
    }
  return merged;
}

function clip(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/** Follow-up text asking the author to fix the selected findings. */
export function authorFollowUp(
  findings: MergedFinding[],
  agentName: (agent: string) => string,
  limit = 10_000,
): string {
  const intro =
    'A Challenge review proved these failures against your change. Reproduce each one, fix the cause, and run its command again to confirm. Commands ran from the reviewer’s workspace, which may hold repro files; read them there without editing them. Preserve unrelated work.';
  const parts = [intro];
  let omitted = 0;
  findings.forEach((item, index) => {
    const part = [
      `${index + 1}. ${item.title} (found by ${item.sources.map((source) => agentName(source.agent)).join(' and ')})`,
      `Reviewer workspace: ${item.sources[0]?.workspace || 'unavailable'}`,
      `Command: ${item.command}`,
      `It printed:\n${clip(item.output, 1_200)}`,
      item.expected && `The intent requires: ${clip(item.expected, 600)}`,
      item.breaks && `Why this breaks the intent: ${clip(item.breaks, 600)}`,
    ]
      .filter(Boolean)
      .join('\n');
    if ([...parts, part].join('\n\n').length > limit) omitted += 1;
    else parts.push(part);
  });
  if (omitted)
    parts.push(
      `${omitted} more ${omitted === 1 ? 'finding was' : 'findings were'} left out to fit.`,
    );
  return parts.join('\n\n');
}
