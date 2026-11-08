import { isActive, isFinished } from '@jackalope/contracts/runs';
import type { TaskRun } from './run-types.ts';

type ReviewSeverity = 'high' | 'medium' | 'low';

export interface ReviewFinding {
  key: string;
  severity: ReviewSeverity;
  title: string;
  file: string;
  line: number | null;
  problem: string;
  fix: string;
}

export interface AgentReviewReport {
  summary: string;
  findings: ReviewFinding[];
}

const SEVERITIES: ReviewSeverity[] = ['high', 'medium', 'low'];
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** The reviewer reply's jackalope-review block, or undefined when it has none or it is invalid. */
export function reviewBlock(reply: string): AgentReviewReport | undefined {
  const tag = '```jackalope-review';
  const start = reply.lastIndexOf(tag);
  if (start < 0) return;
  const body = reply.slice(start + tag.length);
  const end = body.indexOf('```');
  let value: unknown;
  try {
    value = JSON.parse(end < 0 ? body : body.slice(0, end));
  } catch {
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.findings) ? record.findings : [];
  const findings = items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, index): ReviewFinding => {
      const severity = text(item.severity).toLowerCase() as ReviewSeverity;
      const line = Number(item.line);
      return {
        key: String(index),
        severity: SEVERITIES.includes(severity) ? severity : 'medium',
        title: text(item.title) || text(item.problem).split('\n')[0] || 'Untitled finding',
        file: text(item.file),
        line: Number.isInteger(line) && line > 0 ? line : null,
        problem: text(item.problem),
        fix: text(item.fix),
      };
    })
    .filter((item) => item.problem || item.fix)
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  return { summary: text(record.summary), findings };
}

export const findingLocation = (finding: Pick<ReviewFinding, 'file' | 'line'>) =>
  finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : '';

export const isAgentReview = (run: Pick<TaskRun, 'challengeOf'>) =>
  run.challengeOf?.kind === 'review';

/** This task's agent reviews, newest first. */
export function taskReviews(runs: TaskRun[], taskId: string) {
  const attempts = new Set(runs.filter((run) => run.taskId === taskId).map((run) => run.id));
  return runs
    .filter((run) => isAgentReview(run) && attempts.has(run.challengeOf?.runId ?? ''))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export type ReviewState = 'running' | 'finished' | 'failed';

export function reviewState(reviewer: TaskRun): ReviewState {
  if (isActive(reviewer)) return 'running';
  return isFinished(reviewer) ? 'finished' : 'failed';
}

function clip(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/** Follow-up asking the author to apply the selected review findings. */
export function fixFollowUp(
  findings: ReviewFinding[],
  { note = '', check }: { note?: string; check?: string },
  limit = 10_000,
): string {
  const parts = [
    'An agent review of your change suggested these fixes. Apply each one, check it against the code first, and skip any that turn out to be wrong, saying why. Preserve unrelated work.',
  ];
  if (note.trim()) parts.push(`From me:\n${clip(note.trim(), 2_000)}`);
  const closing = check
    ? `When the fixes are done, run \`${check}\` once and fix anything it reports.`
    : 'When the fixes are done, run the project’s usual typecheck or tests once if they are quick, and say what you ran.';
  let omitted = 0;
  findings.forEach((item, index) => {
    const location = findingLocation(item);
    const part = [
      `${index + 1}. [${item.severity}] ${item.title}${location ? ` (${location})` : ''}`,
      item.problem && `Problem: ${clip(item.problem, 1_200)}`,
      item.fix && `Fix: ${clip(item.fix, 1_200)}`,
    ]
      .filter(Boolean)
      .join('\n');
    if ([...parts, part, closing].join('\n\n').length > limit) omitted += 1;
    else parts.push(part);
  });
  if (omitted)
    parts.push(
      `${omitted} more ${omitted === 1 ? 'finding was' : 'findings were'} left out to fit.`,
    );
  parts.push(closing);
  return parts.join('\n\n');
}

/**
 * What the author recorded as proof, for a reviewer that cannot see the author's run: its
 * goal, validation steps, decisions and screenshots. Without it a reviewer reads claims
 * about checks it was never shown as unbacked. Empty when nothing was recorded.
 */
export function authorEvidence(
  run: Pick<TaskRun, 'understanding' | 'validationSteps' | 'decisions' | 'screenshots'>,
) {
  const lines: string[] = [];
  if (run.understanding?.goal) lines.push(`Goal: ${run.understanding.goal}`);
  for (const step of run.validationSteps ?? []) {
    const evidence = step.evidence.length ? ` Evidence: ${step.evidence.join(', ')}` : '';
    lines.push(
      `- Check (${step.status}): ${step.step}.${step.notes ? ` ${step.notes}` : ''}${evidence}`,
    );
  }
  for (const entry of run.decisions ?? []) {
    lines.push(`- Decision (${entry.phase}): ${entry.decision}. Result: ${entry.result}`);
  }
  for (const shot of run.screenshots ?? []) lines.push(`- Screenshot: ${shot.filePath}`);
  if (!lines.length) return '';
  return [
    "The author's recorded evidence (verify it rather than trusting it; do not report a claim as unbacked when it is listed here):",
    ...lines,
  ]
    .join('\n')
    .slice(0, 6000);
}
