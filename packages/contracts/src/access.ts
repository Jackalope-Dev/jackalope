import type { Platform, ReleaseChannel } from './platform.ts';

/** Waitlist survey answers. Each value also becomes a mailing-list tag. */
export const PREFERENCE_PLATFORMS = ['windows', 'macos', 'linux'] as const satisfies Platform[];
export const PREFERENCE_AGENTS = [
  'codex',
  'claude',
  'opencode',
  'grok',
  'antigravity',
  'cursor',
  'gemini',
  'other',
  'exploring',
] as const;
export const PREFERENCE_PRIORITIES = [
  'parallel',
  'review',
  'context',
  'accounts',
  'recurring',
  'remote',
] as const;
export type PreferenceAgent = (typeof PREFERENCE_AGENTS)[number];
export type PreferencePriority = (typeof PREFERENCE_PRIORITIES)[number];
export interface WaitlistPreferences {
  platforms: Platform[];
  agents: PreferenceAgent[];
  priorities: PreferencePriority[];
}

export const BUILD_KINDS = ['development', 'release'] as const;
export const PROFILE_KINDS = ['default', 'isolated'] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];
export type ProfileKind = (typeof PROFILE_KINDS)[number];

/** A desktop connected to an account, as `/v1/access/devices` lists it. */
export interface ConnectedDevice {
  id: string;
  name: string | null;
  createdAt: number;
  expiresAt: number;
  appVersion: string | null;
  platform: Platform | null;
  buildKind: BuildKind | null;
  profileKind: ProfileKind | null;
  lastSeenAt: number | null;
  settingsCheckedAt: number | null;
  settingsSync: number;
}

export interface Invitation {
  id: string;
  email: string;
  status: string;
  expires_at: number;
  accepted_at: number | null;
  downloaded_at: number | null;
  connected_at: number | null;
  last_sent: number;
}

/** A member's Instant Access Passes and how the people they invited got on. */
export interface InvitationSummary {
  limit: number;
  remaining: number;
  accepted: number;
  downloaded: number;
  connected: number;
  shareUrl: string;
  invites: Invitation[];
}

/** A non-public build a member may download, through the access service. */
export interface ReleaseBuild {
  id: string;
  label: string;
  channel: ReleaseChannel;
  url: string;
}

/** `/v1/access/me` */
export interface AccessMember extends InvitationSummary {
  email: string;
  /** Anyone can join, so Instant Access Passes no longer admit anyone. */
  openSignup: boolean;
  macos: ReleaseBuild[];
  linux: ReleaseBuild[];
  download: { url: string; bytes?: number; kind?: 'store' } | null;
}
