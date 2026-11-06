import type { CloudResourceKind } from './cloud-resources-plan';
import { nativeTask } from './task-runtime';

export type CloudResourceStep = 'account' | CloudResourceKind | 'manifest';

export interface CloudResource {
  kind: CloudResourceKind;
  name: string;
  /** What bindings reference: the bucket name for R2, the site key for Turnstile. */
  id?: string;
  binding?: string;
}

/** `.jackalope/cloudflare.json`; it holds no secret. */
export interface CloudResourceManifest {
  version: number;
  accountId: string;
  prefix: string;
  resources: CloudResource[];
  /** JSONC to merge into wrangler.jsonc. */
  wrangler: string;
  dashboard: string;
  updatedAt: string;
}

export interface CloudResourcesStatus {
  manifest: CloudResourceManifest | null;
  /** Git ignores the manifest in this checkout. */
  ignored: boolean;
  postgresSaved: boolean;
  /** The connected Cloudflare account, or null when Cloudflare is not connected. */
  accountId: string | null;
}

export interface CloudResourcesFailure {
  step: CloudResourceStep;
  message: string;
  recovery: 'reauthorize' | 'token' | 'enable' | null;
  link: string | null;
  /** Connect Cloudflare scopes to ask for again. */
  scopes: string[];
  /** API token permissions the failed step needs. */
  permissions: string[];
}

type ProvisionResult =
  | { ok: true; manifest: CloudResourceManifest | null }
  | { ok: false; failure: CloudResourcesFailure; manifest: CloudResourceManifest | null };

export interface CloudResourcesRequest {
  prefix: string;
  kinds: CloudResourceKind[];
  postgresUrl?: string;
  turnstileDomains: string[];
}

export const cloudResourcesStatus = (projectPath: string) =>
  nativeTask<CloudResourcesStatus>('cloudflare_resources_status', { projectPath });

/** Finds or creates each resource and writes the manifest; retrying reuses what exists. */
export const provisionCloudResources = (projectPath: string, request: CloudResourcesRequest) =>
  nativeTask<ProvisionResult>('cloudflare_resources_provision', { projectPath, request });

/** Removes a resource from the manifest; Cloudflare keeps it. */
export const forgetCloudResource = (projectPath: string, kind: CloudResourceKind) =>
  nativeTask<CloudResourceManifest | null>('cloudflare_resources_forget', { projectPath, kind });

/** Deletes the resource from Cloudflare, then removes it from the manifest. */
export const deleteCloudResource = (projectPath: string, kind: CloudResourceKind) =>
  nativeTask<CloudResourceManifest | null>('cloudflare_resources_delete', { projectPath, kind });

/** Reads the Turnstile secret key from Cloudflare; it is never saved. */
export const turnstileSecret = (projectPath: string) =>
  nativeTask<string>('cloudflare_resources_turnstile_secret', { projectPath });

export async function onCloudResourcesProgress(
  listener: (progress: { projectPath: string; step: CloudResourceStep }) => void,
) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ projectPath: string; step: CloudResourceStep }>(
    'cloudflare-resources-progress',
    (event) => listener(event.payload),
  );
}
