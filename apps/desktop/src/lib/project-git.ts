import { invokeNative } from './native/transport';

export interface CommitPolicy {
  attribution: 'agent' | 'coAuthor' | 'user';
  name: string;
  email: string;
  cleanupAfterMerge: boolean;
  autoCheckpoint: boolean;
}

export const projectGitPolicy = (projectPath: string, policy?: CommitPolicy) =>
  invokeNative<CommitPolicy>('project_git_policy', { projectPath, policy });

export interface FirstCommitPreview {
  /** Files the commit would include; ignored files are left out. */
  files: number;
  /** The configured Git identity, or null when a commit would be refused. */
  identity: { name: string; email: string } | null;
}

export const firstCommitPreview = (projectPath: string) =>
  invokeNative<FirstCommitPreview>('project_first_commit_preview', { projectPath });
/** Commits as the configured Git identity; `files` is the approved count from the preview. */
export const createFirstCommit = (projectPath: string, files: number) =>
  invokeNative<void>('project_first_commit', { projectPath, files });

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
  additions: number | null;
  deletions: number | null;
}

export interface WorkingChanges {
  branch: string | null;
  head: string | null;
  files: ChangedFile[];
}

/** Uncommitted changes in `worktreePath`, a checkout of the repository at `repoPath`. */
export const workingChanges = (checkout: { repoPath: string; worktreePath: string }) =>
  invokeNative<WorkingChanges>('git_working_changes', checkout);
