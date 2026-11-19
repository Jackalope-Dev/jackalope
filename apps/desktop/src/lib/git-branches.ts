import { invokeNative } from './native/transport.ts';

/** A project checkout's branches, most recently committed first. */
export interface BranchList {
  /** Empty on a detached commit. */
  current: string;
  /** Uncommitted changes to tracked files; only a new branch can take them along. */
  changed: boolean;
  /** `worktree` is set when another worktree has the branch checked out. */
  local: { name: string; worktree?: string | null }[];
  /** Remote branches without a local branch of the same name, as `remote/name`. */
  remote: string[];
}

export function listBranches(repoPath: string): Promise<BranchList> {
  return invokeNative<BranchList>('git_list_branches', { repoPath });
}

/** Switches the project checkout, or creates a branch at its current commit; resolves to the branch now checked out. */
export function switchBranch(repoPath: string, branch: string, create: boolean): Promise<string> {
  return invokeNative<string>('git_switch_branch', { repoPath, branch, create });
}
