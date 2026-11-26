import { invokeNative } from './native/transport.ts';

/** A repository on this computer that is not a project yet. */
export interface RepositoryCandidate {
  /** The main checkout; worktrees are folded into it. */
  path: string;
  name: string;
  hasCommits: boolean;
  lastCommitAt?: string | null;
  remoteHost?: string | null;
  /** Claude Code and Codex conversations that ran in it. */
  sessions: number;
  lastSessionAt?: string | null;
  sources: ('sessions' | 'folders' | 'editor')[];
  /** One of the few the scan suggests adding. */
  recommended: boolean;
}

export interface DiscoveryScan {
  candidates: RepositoryCandidate[];
  truncated: boolean;
}

/** Looks for repositories in agent history, common code folders and recent editor folders. */
export const scanForProjects = () => invokeNative<DiscoveryScan>('project_discovery_scan');

/** The most recent of a candidate's last conversation and last commit. */
export function lastActivity(candidate: RepositoryCandidate) {
  const times = [candidate.lastSessionAt, candidate.lastCommitAt]
    .map((at) => (at ? new Date(at).getTime() : Number.NaN))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)) : null;
}

/** What the person sees about why a repository is listed. */
export function candidateDetail(candidate: RepositoryCandidate) {
  const parts: string[] = [];
  if (candidate.sessions)
    parts.push(
      `${candidate.sessions} agent ${candidate.sessions === 1 ? 'conversation' : 'conversations'}`,
    );
  if (!candidate.hasCommits) parts.push('No commits yet');
  if (candidate.remoteHost) parts.push(candidate.remoteHost);
  return parts;
}

export function recommendedPaths(candidates: RepositoryCandidate[]) {
  return new Set(candidates.filter((item) => item.recommended).map((item) => item.path));
}
