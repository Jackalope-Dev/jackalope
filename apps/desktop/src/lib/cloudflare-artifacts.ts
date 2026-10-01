import { syncAgentConfig } from '../stores/agentConfigStore';
import { type Project, projectPathKey, useProjectStore } from '../stores/projectStore';
import { commitProjectSetup, projectGitState } from './project-setup';
import { nativeTask } from './task-runtime';

export { suggestRepoName, validRepoName } from './artifacts-repo-name';

export const ARTIFACTS_DOCS_URL = 'https://developers.cloudflare.com/artifacts/';
export const ARTIFACTS_TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens';

export type ArtifactsJurisdiction = '' | 'eu' | 'us';

export interface ArtifactsStatus {
  connected: boolean;
  accountId?: string | null;
  namespace?: string | null;
  jurisdiction?: 'eu' | 'us' | null;
  /** oauth for Connect Cloudflare, token for a pasted API token. */
  method?: 'oauth' | 'token' | null;
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface ArtifactsProjectLink {
  repository: boolean;
  remote?: string | null;
  repo?: string | null;
  namespace?: string | null;
  foreign: boolean;
}

export interface ArtifactsPushResult {
  repo: string;
  remote: string;
  summary: string;
}

export interface ArtifactsReviewShare {
  repo: string;
  remote: string;
  expiresAt: string;
  cloneCommand: string;
}

interface CreatedProject {
  project: { path: string; name: string; branch: string; repository: boolean };
  repo: string;
  remote: string;
  pushError?: string | null;
}

export const artifactsStatus = () => nativeTask<ArtifactsStatus>('cloudflare_artifacts_status');

export const connectArtifacts = (connection: {
  accountId: string;
  namespace: string;
  jurisdiction: ArtifactsJurisdiction;
  token: string;
}) =>
  nativeTask<ArtifactsStatus>('cloudflare_artifacts_connect', {
    connection: { ...connection, jurisdiction: connection.jurisdiction || null },
  });

export const disconnectArtifacts = () => nativeTask<void>('cloudflare_artifacts_disconnect');

/** Prepares Connect Cloudflare and returns the consent page to open in the browser. */
export const beginCloudflareSignIn = () => nativeTask<string>('cloudflare_oauth_begin');
/** Waits for the browser to return; resolves with the accounts the person shared. */
export const completeCloudflareSignIn = () =>
  nativeTask<CloudflareAccount[]>('cloudflare_oauth_complete');
export const cancelCloudflareSignIn = () => nativeTask<void>('cloudflare_oauth_cancel');
export const connectCloudflareAccount = (connection: {
  accountId: string;
  namespace: string;
  jurisdiction: ArtifactsJurisdiction;
}) =>
  nativeTask<ArtifactsStatus>('cloudflare_oauth_connect', {
    ...connection,
    jurisdiction: connection.jurisdiction || null,
  });

export const artifactsProject = (projectPath: string) =>
  nativeTask<ArtifactsProjectLink>('cloudflare_artifacts_project', { projectPath });

export const convertToArtifacts = (projectPath: string, repoName: string, description: string) =>
  nativeTask<ArtifactsPushResult>('cloudflare_artifacts_convert', {
    projectPath,
    repoName,
    description,
  });

export const pushToArtifacts = (projectPath: string) =>
  nativeTask<ArtifactsPushResult>('cloudflare_artifacts_push', { projectPath });

export const shareArtifactsReview = (projectPath: string, hours: 1 | 24 | 168) =>
  nativeTask<ArtifactsReviewShare>('cloudflare_artifacts_share', { projectPath, hours });

/** Creates the Artifacts repository and the local folder, then pushes the first commit. */
export async function createArtifactsProject(
  name: string,
  parentPath: string | null,
  repoName: string,
  options: { provisional?: boolean } = {},
): Promise<{ project: Project; pushError?: string }> {
  await syncAgentConfig();
  const created = await nativeTask<CreatedProject>('cloudflare_artifacts_create_project', {
    name: name.trim(),
    parentPath,
    repoName,
  });
  const existing = useProjectStore
    .getState()
    .projects.find(
      (project) => projectPathKey(project.path) === projectPathKey(created.project.path),
    );
  const project: Project = existing
    ? { ...existing, ...projectGitState(created.project), worktrees: [] }
    : {
        id: crypto.randomUUID(),
        name: created.project.name,
        path: created.project.path,
        ...projectGitState(created.project),
        agentProvider: 'codex' as const,
        worktrees: [],
      };
  return {
    project: options.provisional ? project : commitProjectSetup(project),
    pushError: created.pushError ?? undefined,
  };
}
