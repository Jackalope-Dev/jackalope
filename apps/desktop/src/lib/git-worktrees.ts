import { isTauriEnvironment } from './native/env.ts';
import { invokeNative } from './native/transport.ts';

export interface WorktreeEntry {
  path: string;
  head: string;
  branch: string;
  is_bare: boolean;
  is_locked: boolean;
  cleanup?: {
    target_branch: string | null;
    target_head: string | null;
    merged: boolean | null;
    blocked_reason: string | null;
    /** Blocked only by recoverable content — archive-and-remove is available. */
    recoverable?: boolean;
    missing?: boolean;
    /** Ignored paths cleanup deletes along with the worktree. */
    discarded_paths?: string[];
    content_merged?: boolean;
  } | null;
}

/** A folder left behind in .worktrees/ that Git no longer registers. */
export interface WorktreeOrphan {
  name: string;
  path: string;
  entries: number;
  blocked_reason: string | null;
}

export function listWorktrees(
  repoPath: string,
  targetBranch?: string,
  inspectCleanup = true,
): Promise<WorktreeEntry[]> {
  return invokeNative<WorktreeEntry[]>('git_list_worktrees', {
    repoPath,
    targetBranch,
    inspectCleanup,
  });
}

export async function cleanupWorktree(repoPath: string, worktree: WorktreeEntry): Promise<void> {
  const status = worktree.cleanup;
  if (
    (!status?.merged && !status?.content_merged) ||
    status.blocked_reason ||
    !status.target_branch ||
    !status.target_head
  ) {
    throw new Error('Refresh and review this worktree before cleanup.');
  }
  await invokeNative('git_cleanup_worktree', {
    deleteBranch: true,
    expectedBranch: worktree.branch,
    repoPath,
    worktreePath: worktree.path,
    targetBranch: status.target_branch,
    expectedHead: worktree.head,
    expectedTargetHead: status.target_head,
  });
}

export async function archiveWorktree(repoPath: string, worktree: WorktreeEntry): Promise<string> {
  const status = worktree.cleanup;
  if (!status?.recoverable || !status.target_branch || !status.target_head) {
    throw new Error('Refresh and review this worktree before archiving.');
  }
  return invokeNative<string>('git_archive_worktree', {
    repoPath,
    worktreePath: worktree.path,
    targetBranch: status.target_branch,
    expectedHead: worktree.head,
    expectedTargetHead: status.target_head,
  });
}

export function pruneWorktrees(repoPath: string): Promise<number> {
  return invokeNative<number>('git_prune_worktrees', { repoPath });
}

export async function listWorktreeOrphans(repoPath: string): Promise<WorktreeOrphan[]> {
  if (!isTauriEnvironment()) return [];
  return invokeNative<WorktreeOrphan[]>('git_list_worktree_orphans', { repoPath });
}

export async function removeWorktreeOrphan(
  repoPath: string,
  folder: WorktreeOrphan,
): Promise<void> {
  if (folder.blocked_reason) throw new Error(folder.blocked_reason);
  await invokeNative('git_remove_worktree_orphan', { repoPath, folderPath: folder.path });
}

export function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  baseCommit?: string,
): Promise<WorktreeEntry> {
  return invokeNative<WorktreeEntry>('git_create_worktree', {
    repoPath,
    worktreePath,
    branchName,
    baseCommit,
  });
}
