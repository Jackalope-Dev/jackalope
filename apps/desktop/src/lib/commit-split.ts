import { describeError, errorCode } from '@jackalope/contracts/errors';
import { invokeNative } from './native/transport.ts';
import type { IntegrationPlan } from './queue.ts';

/** One commit of a split integration, matching `split::PlannedCommit`. */
export interface PlannedCommit {
  /** The approved message, before project trailers are added. */
  message: string;
  /** Unit IDs (`h1`, `h2`…) in diff order. */
  hunks: string[];
  files: string[];
  /** Zero-based positions of earlier commits this one needs. */
  dependsOn?: number[];
  /** The built commit, once the split is applied. */
  commit?: string | null;
}

/** One hunk, or one whole file, of the change being split. */
export interface SplitUnit {
  id: string;
  path: string;
  added: number;
  removed: number;
  /** New, deleted, binary, mode-changing or single-hunk files move as one unit. */
  whole: boolean;
  /** Lock files are placed with their manifest's commit by Jackalope. */
  lock: boolean;
}

/** Matches `split::SplitProposal`. */
export interface SplitProposal {
  planId: string;
  integrationHead: string;
  commits: PlannedCommit[];
  hunks: number;
  units: SplitUnit[];
  fileLevel: boolean;
  /** Why the integration keeps its single commit; `commits` is empty then. */
  fallback: string | null;
}

export const proposeSplit = (planId: string) =>
  invokeNative<SplitProposal>('integration_split_propose', { planId });
export const applySplit = (planId: string, integrationHead: string, commits: PlannedCommit[]) =>
  invokeNative<IntegrationPlan>('integration_split_apply', { planId, integrationHead, commits });

export function commitTitle(message: string) {
  return message.trim().split('\n')[0]?.trim() ?? '';
}

export function commitBody(message: string) {
  const trimmed = message.trim();
  const newline = trimmed.indexOf('\n');
  return newline < 0 ? '' : trimmed.slice(newline + 1).trim();
}

export interface CommitFile {
  path: string;
  /** Hunks of this file in the commit, and in the whole change. */
  hunks: number;
  totalHunks: number;
  added: number;
  removed: number;
  whole: boolean;
  lock: boolean;
}

/** The files a commit touches, in its own order, with its share of each. */
export function commitFiles(commit: PlannedCommit, units: SplitUnit[]): CommitFile[] {
  const files: CommitFile[] = [];
  for (const path of commit.files) {
    const all = units.filter((unit) => unit.path === path);
    const mine = all.filter((unit) => commit.hunks.includes(unit.id));
    files.push({
      path,
      hunks: mine.length,
      totalHunks: all.length,
      added: mine.reduce((sum, unit) => sum + unit.added, 0),
      removed: mine.reduce((sum, unit) => sum + unit.removed, 0),
      whole: all.length > 0 && all.every((unit) => unit.whole),
      lock: all.some((unit) => unit.lock),
    });
  }
  return files;
}

/** "Needs 1", "Needs 1 and 3", "Needs 1, 2 and 4", using one-based numbers. */
export function dependencyLabel(dependsOn: number[] | undefined) {
  const numbers = [...new Set(dependsOn ?? [])].sort((a, b) => a - b).map((index) => index + 1);
  if (!numbers.length) return '';
  const listed =
    numbers.length === 1
      ? `${numbers[0]}`
      : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
  return `Needs ${listed}`;
}

/** What a split failure asks the person to do next. */
export type SplitRecovery = 'propose' | 'refresh' | null;

/**
 * A split command's failure in the person's terms, from the `code` the native
 * `SplitError` attaches: `proposalStale` (propose again), `reviewStale` (prepare
 * a fresh review) or `treeMismatch` (the commits missed the reviewed files).
 */
export function splitFailure(cause: unknown): { message: string; recovery: SplitRecovery } {
  switch (errorCode(cause)) {
    case 'treeMismatch':
      return {
        message:
          'Jackalope refused this split because its commits do not add up to the reviewed files exactly. The integration keeps its current commits. Propose a new split or merge as it is.',
        recovery: 'propose',
      };
    case 'proposalStale':
      return {
        message: 'The integration changed after this split was proposed. Propose a new split.',
        recovery: 'propose',
      };
    case 'reviewStale':
      return {
        message: describeError(cause),
        recovery: 'refresh',
      };
    default:
      return { message: describeError(cause), recovery: null };
  }
}

/** "one commit" or "3 commits". */
export function commitCount(count: number) {
  return count === 1 ? 'one commit' : `${count} commits`;
}
