import { nativeTask } from './task-runtime';

export interface CommitPolicy {
  attribution: 'agent' | 'coAuthor' | 'user';
  name: string;
  email: string;
  cleanupAfterMerge: boolean;
  autoCheckpoint: boolean;
}

export const projectGitPolicy = (projectPath: string, policy?: CommitPolicy) =>
  nativeTask<CommitPolicy>('project_git_policy', { projectPath, policy });

export interface FirstCommitPreview {
  /** Files the commit would include; ignored files are left out. */
  files: number;
  /** The configured Git identity, or null when a commit would be refused. */
  identity: { name: string; email: string } | null;
}

export const firstCommitPreview = (projectPath: string) =>
  nativeTask<FirstCommitPreview>('project_first_commit_preview', { projectPath });
/** Commits as the configured Git identity; `files` is the approved count from the preview. */
export const createFirstCommit = (projectPath: string, files: number) =>
  nativeTask<void>('project_first_commit', { projectPath, files });
