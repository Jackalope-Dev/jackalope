import type { Comparison } from '../stores/compareStore.ts';
import { getAgentMetadata } from './agent-catalog.ts';

/** One finished attempt as the judge sees it, labelled A, B, C… in launch order. */
export interface JudgedAttempt {
  label: string;
  agentName: string;
  workspace: string;
  branch: string;
  baseHead: string;
  files: string[];
  patch: string;
}

interface VerdictPort {
  attempt: string;
  what: string;
  files: string[];
}

/** The judge's structured answer, validated against the attempt labels it was given. */
export interface Verdict {
  criteria: { id: string; text: string }[];
  /** Attempt label → criterion id → score from 1 to 5 with an optional note. */
  scores: Record<string, Record<string, { score: number; note?: string }>>;
  base?: { attempt: string; reason: string };
  ports: VerdictPort[];
  ambiguous?: { reason: string; prompt: string };
}

const VERDICT_FENCE = 'jackalope-verdict';
const REQUEST_LIMIT = 4_000;
const PATCH_BUDGET = 12_000;

export const attemptLabel = (index: number) => String.fromCharCode(65 + index);

/** Agents from the same vendor share a family; unknown agents are their own family. */
function agentFamily(adapter: string) {
  return getAgentMetadata(adapter)?.vendor ?? adapter;
}

/**
 * Prefers an available agent from a family none of the attempts used, so the judge
 * does not grade its own family's work. Falls back to the first candidate.
 */
export function pickJudgeAgent(
  candidates: { id: string; adapter: string }[],
  authorAdapters: string[],
): { id: string; independent: boolean } | undefined {
  const authors = new Set(authorAdapters.map(agentFamily));
  const independent = candidates.find((candidate) => !authors.has(agentFamily(candidate.adapter)));
  if (independent) return { id: independent.id, independent: true };
  return candidates[0] && { id: candidates[0].id, independent: false };
}

export function isIndependentJudge(adapter: string, authorAdapters: string[]) {
  return !authorAdapters.map(agentFamily).includes(agentFamily(adapter));
}

export function buildJudgePrompt(request: string, attempts: JudgedAttempt[]): string {
  const share = Math.max(1_500, Math.floor(PATCH_BUDGET / Math.max(attempts.length, 1)));
  const sections = attempts.map((attempt) => {
    const excerpt = attempt.patch.length > share;
    return `### Attempt ${attempt.label} (${attempt.agentName})
Worktree: ${attempt.workspace}
Branch: ${attempt.branch || 'none'}
All changes: git -C "${attempt.workspace}" diff ${attempt.baseHead} (plus untracked files from git status)
Changed files:
${attempt.files.join('\n').slice(0, 1_000) || 'none reported'}

Patch${excerpt ? ' (excerpt; read the worktree for the rest)' : ''}:
${attempt.patch.slice(0, share) || 'No patch was captured.'}`;
  });
  const labels = attempts.map((attempt) => attempt.label);
  return `Judge ${attempts.length} attempts at the same request and recommend which one to build on.

This is a read-only judging task. Do not edit files, apply fixes, create commits or merge changes in any worktree. Only read files and run read-only Git commands.

Original request:
${request.slice(0, REQUEST_LIMIT)}

1. Before reading any attempt, write 3 to 6 concrete criteria a reviewer could check for this request. Base them on the request alone.
2. Read each attempt's actual changes in its worktree. Score every attempt on every criterion from 1 (missing or wrong) to 5 (fully met), with a short note.
3. Name the attempt a maintainer could extend most easily without breaking things as the base.
4. List one or two parts of the other attempts worth porting into the base, each with its source attempt and files. List none if nothing is worth porting.
5. If the attempts differ so much that the request itself looks ambiguous, say so, leave out the base and suggest a clearer request instead.

${sections.join('\n\n')}

Explain your reasoning briefly, then end with exactly one fenced block tagged ${VERDICT_FENCE} holding JSON in this shape:

\`\`\`${VERDICT_FENCE}
{
  "criteria": [{ "id": "C1", "text": "…" }],
  "scores": { "${labels[0] ?? 'A'}": { "C1": { "score": 4, "note": "…" } } },
  "base": { "attempt": "${labels[0] ?? 'A'}", "reason": "…" },
  "ports": [{ "from": "${labels[1] ?? 'B'}", "what": "…", "files": ["path/to/file"] }],
  "ambiguous": null
}
\`\`\`

Use only the attempt labels ${labels.join(', ')}. When the request looks ambiguous, set "base" to null and "ambiguous" to { "reason": "…", "clarifiedPrompt": "…" }.`;
}

const text = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function verdictJson(answer: string): unknown {
  const blocks = [...answer.matchAll(/```([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const tagged = blocks.filter((block) => block[1] === VERDICT_FENCE);
  const candidates = tagged.length
    ? tagged
    : blocks.filter((block) => block[1] === 'json' && block[2].includes('"criteria"'));
  const block = candidates.at(-1);
  if (!block) return undefined;
  try {
    return JSON.parse(block[2]);
  } catch {
    return undefined;
  }
}

/**
 * Reads the judge's final answer. Returns undefined when it holds no usable verdict,
 * so the caller can show the answer as written instead.
 */
export function parseVerdict(answer: string, labels: string[]): Verdict | undefined {
  const value = record(verdictJson(answer));
  if (!value || !Array.isArray(value.criteria)) return undefined;
  const known = new Set(labels);
  const criteria = value.criteria
    .map((item, index) => {
      const entry = record(item);
      return {
        id: text(entry?.id, 20) || `C${index + 1}`,
        text: text(entry?.text, 300),
      };
    })
    .filter((criterion) => criterion.text)
    .slice(0, 8);
  if (!criteria.length) return undefined;
  const ids = new Set(criteria.map((criterion) => criterion.id));
  const scores: Verdict['scores'] = {};
  for (const [label, row] of Object.entries(record(value.scores) ?? {})) {
    if (!known.has(label)) continue;
    scores[label] = {};
    for (const [id, cell] of Object.entries(record(row) ?? {})) {
      const entry = record(cell);
      const raw = typeof cell === 'number' ? cell : Number(entry?.score);
      if (!ids.has(id) || !Number.isFinite(raw)) continue;
      const note = text(entry?.note, 240);
      scores[label][id] = {
        score: Math.min(5, Math.max(1, Math.round(raw))),
        ...(note && { note }),
      };
    }
  }
  const baseEntry = record(value.base);
  const baseLabel = text(baseEntry?.attempt, 4);
  const base = known.has(baseLabel)
    ? { attempt: baseLabel, reason: text(baseEntry?.reason, 600) }
    : undefined;
  const ports = (Array.isArray(value.ports) ? value.ports : [])
    .map((item) => {
      const entry = record(item);
      return {
        attempt: text(entry?.from ?? entry?.attempt, 4),
        what: text(entry?.what, 400),
        files: (Array.isArray(entry?.files) ? entry.files : [])
          .map((file) => text(file, 300))
          .filter(Boolean)
          .slice(0, 20),
      };
    })
    .filter((port) => known.has(port.attempt) && port.what && port.attempt !== base?.attempt)
    .slice(0, 6);
  const ambiguousEntry = record(value.ambiguous);
  const ambiguous = ambiguousEntry
    ? {
        reason: text(ambiguousEntry.reason, 600),
        prompt: text(ambiguousEntry.clarifiedPrompt ?? ambiguousEntry.prompt, 4_000),
      }
    : undefined;
  if (!base && !ambiguous?.reason) return undefined;
  return {
    criteria,
    scores,
    ports,
    ...(base && { base }),
    ...(ambiguous?.reason && { ambiguous }),
  };
}

/** A part of another attempt the kept attempt should bring over. */
export interface CombinePort extends VerdictPort {
  agentName: string;
  workspace: string;
  branch: string;
  baseHead: string;
}

export function buildCombinePrompt(ports: CombinePort[]): string {
  const items = ports.map(
    (port, index) => `${index + 1}. ${port.what}
   From attempt ${port.attempt} (${port.agentName})
   Files: ${port.files.join(', ') || 'see its changes'}
   Source worktree: ${port.workspace}${port.branch ? ` (branch ${port.branch})` : ''}
   Its changes: git -C "${port.workspace}" diff ${port.baseHead}`,
  );
  return `Bring the parts below from other attempts at this request into this work.

Read each source to understand the change, then fit it into this attempt's structure instead of copying whole files. Treat the source worktrees as read-only.

${items.join('\n\n')}

Run the project's checks afterwards. Report what you brought over and anything you left out, with the reason.`;
}

const pathKey = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

interface RetentionRun {
  taskId: string;
  startedAt: string;
  status: string;
  workspace: string;
}

/**
 * Worktrees of archived attempts a combine follow-up still needs. They stay retained
 * while the follow-up draft has text and no follow-up has started, and while a
 * follow-up that started after the draft is unfinished. A finished or cleared
 * follow-up releases them.
 */
export function retainedWorkspaces(
  comparisons: Comparison[],
  runs: RetentionRun[],
  draftText: (taskId: string) => string,
): Set<string> {
  const retained = new Set<string>();
  for (const { combine } of comparisons) {
    if (!combine) continue;
    const drafted = Date.parse(combine.draftedAt);
    const followUp = runs
      .filter((run) => run.taskId === combine.baseTaskId && Date.parse(run.startedAt) > drafted)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    const pending = followUp
      ? ['starting', 'running', 'stopping', 'interrupted'].includes(followUp.status)
      : !!draftText(combine.baseTaskId).trim();
    if (pending) for (const source of combine.sources) retained.add(pathKey(source.workspace));
  }
  return retained;
}

export const isRetainedWorkspace = (retained: Set<string>, path: string) =>
  retained.has(pathKey(path));
