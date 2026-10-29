import { nativeTask } from './task-runtime.ts';

/** Who a persistent agent browser belongs to: a project, or a bot across projects. */
export interface BrowserProfileOwner {
  kind: 'project' | 'bot';
  id: string;
  name: string;
}

export interface BrowserProfileStatus {
  id: string;
  name: string;
  ownerKind: 'project' | 'bot';
  ownerId: string;
  createdAt: string;
  lastUsedAt?: string | null;
  /** Domains holding cookies when the profile last closed. Names only, never values. */
  signedInSites: string[];
  sizeBytes: number;
  /** What holds the profile now: a task, the sign-in window or a cleanup. */
  inUse?: string | null;
  windowOpen: boolean;
}

export const browserProfileStatus = (owner: BrowserProfileOwner) =>
  nativeTask<BrowserProfileStatus | null>('browser_profile_status', {
    ownerKind: owner.kind,
    ownerId: owner.id,
  });

/** Opens the owner's profile in a visible window to sign in, creating it on first use. */
export const openBrowserProfile = (owner: BrowserProfileOwner, url?: string) =>
  nativeTask<BrowserProfileStatus>('browser_profile_open', {
    ownerKind: owner.kind,
    ownerId: owner.id,
    ownerName: owner.name,
    url: url?.trim() || null,
  });

export const closeBrowserProfile = (id: string) =>
  nativeTask<BrowserProfileStatus>('browser_profile_close', { id });

export const clearBrowserProfileSite = (id: string, site: string) =>
  nativeTask<BrowserProfileStatus>('browser_profile_clear_site', { id, site });

export const deleteBrowserProfile = (id: string) =>
  nativeTask<void>('browser_profile_delete', { id });

/** Disk use as people read it: KB below 1 MB, one decimal in GB. */
export function profileSize(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** The key site decisions for a bot's browser are saved under. */
export const botSiteDecisionKey = (botId: string) => `bot:${botId}`;
