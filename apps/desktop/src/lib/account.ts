/**
 * The optional Jackalope account. Local tasks, conversations, terminals,
 * previews, checks, swarms, MCP and device pairing never need one; only the
 * features below call the Jackalope service, and the native host refuses them
 * without a current, approved account (`AccountFeature` in commands/account.rs).
 */
import type { WaitlistProgress } from '../components/account/WaitlistAccount';

export interface AccountStatus {
  state:
    | 'unavailable'
    | 'disconnected'
    | 'pending'
    | 'waiting'
    | 'waiting-offline'
    | 'connected'
    | 'offline'
    | 'expired';
  email: string | null;
  userCode: string | null;
  expiresAt: number | null;
  waitlist?: WaitlistProgress | null;
}

export type AccountFeature =
  | 'settingsSync'
  | 'lessonSync'
  | 'skillSync'
  | 'invitations'
  | 'memberFeedback'
  | 'betaProgram';

/** Each account feature and why it needs the account: what the service keeps for it. */
export const ACCOUNT_FEATURES: Record<AccountFeature, { title: string; reason: string }> = {
  settingsSync: {
    title: 'Settings sync',
    reason: 'Synced settings are saved with your account, so your other computers can use them.',
  },
  lessonSync: {
    title: 'Lesson sync',
    reason:
      'Synced lessons are saved with your account, so every computer you sign in on can use them.',
  },
  skillSync: {
    title: 'Skill sync',
    reason: 'Synced skills are saved with your account and kept the same on your other computers.',
  },
  invitations: {
    title: 'Invitations',
    reason: 'Your share link and Instant Access Passes belong to your account.',
  },
  memberFeedback: {
    title: 'Feedback invitations',
    reason: 'Feedback invitations are coordinated with your account so you aren’t asked twice.',
  },
  betaProgram: {
    title: 'Beta program',
    reason: 'Beta requests are tied to your account so we can add you to the Store beta.',
  },
};

/** What connecting adds, in one sentence, wherever an account is suggested. */
export const ACCOUNT_BENEFITS =
  'A free account syncs your settings, lessons and skills across computers, and lets you invite friends and join the Microsoft Store beta.';

/** Where the account stands for gating: only `approved` unlocks account features. */
export type AccountAccess =
  | 'loading'
  | 'unavailable'
  | 'none'
  | 'pending'
  | 'waitlist'
  | 'approved';

export function accountAccess(status: AccountStatus | null): AccountAccess {
  switch (status?.state) {
    case undefined:
      return 'loading';
    case 'unavailable':
      return 'unavailable';
    case 'connected':
    case 'offline':
      return 'approved';
    case 'waiting':
    case 'waiting-offline':
      return 'waitlist';
    case 'pending':
      return 'pending';
    default:
      return 'none';
  }
}

/** The one account suggestion's history: shown at most once, and again once after "Not now". */
export type SuggestionState = 'unseen' | 'shown' | 'snoozed' | 'dismissed';

/**
 * Whether the one account suggestion may show now. It appears after a milestone,
 * stays only for the launch it appeared in, and returns at most once after
 * "Not now".
 */
export function suggestionDue(
  prompts: { suggestion: SuggestionState; snoozedUntil: number; shownThisLaunch: boolean },
  milestone: boolean,
  now: number,
): boolean {
  switch (prompts.suggestion) {
    case 'unseen':
      return milestone;
    case 'shown':
      return prompts.shownThisLaunch;
    case 'snoozed':
      return milestone && now >= prompts.snoozedUntil;
    default:
      return false;
  }
}
