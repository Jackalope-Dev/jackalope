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
