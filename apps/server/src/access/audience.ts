/**
 * Describes a member to Sequenzy.
 *
 * The service already knows where someone signed up, which campaign brought
 * them, how far through onboarding they are and what they said they care
 * about. None of that is useful for choosing who receives a product note until
 * it reaches the audience, so this module turns a member row into tags and
 * attributes and keeps them reconciled.
 *
 * Tags answer "who is this"; attributes answer "with what detail". Segments in
 * Sequenzy are built on top of both, so keep the vocabulary small and stable -
 * renaming a tag silently empties every segment that referenced it.
 */

export type MemberRow = {
  email: string;
  status: string;
  source: string;
  newsletter: number;
  created_at: number;
  approved_at: number | null;
  verified_at: number | null;
  waitlist_verified_at: number | null;
  first_download_at: number | null;
  first_desktop_at: number | null;
  referral_count: number;
  waitlist_referrer_id: string | null;
  invited_by: string | null;
  preferences: string | null;
  campaign: string | null;
};

/** Every tag this service maintains. Anything outside this set is left alone. */
export const MANAGED_TAGS = [
  'jackalope-waitlist',
  'jackalope-verified',
  'jackalope-early-access',
  'jackalope-desktop-connected',
  'jackalope-downloaded',
  'jackalope-referrer',
  'signup-website-inline',
  'signup-website-popup',
  'signup-access-pass',
  'signup-waitlist-referral',
  'platform-windows',
  'platform-macos',
  'platform-linux',
  'agent-codex',
  'agent-claude',
  'agent-opencode',
  'agent-grok',
  'agent-antigravity',
  'agent-cursor',
  'agent-gemini',
  'agent-other',
  'agent-exploring',
  'wants-parallel',
  'wants-review',
  'wants-context',
  'wants-accounts',
  'wants-recurring',
  'wants-remote',
] as const;

const PLATFORMS = new Set(['windows', 'macos', 'linux']);
const AGENTS = new Set([
  'codex',
  'claude',
  'opencode',
  'grok',
  'antigravity',
  'cursor',
  'gemini',
  'other',
  'exploring',
]);
const PRIORITIES = new Set(['parallel', 'review', 'context', 'accounts', 'recurring', 'remote']);

const parse = (value: string | null): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};
const list = (value: unknown, allowed: Set<string>) =>
  Array.isArray(value) ? value.filter((item): item is string => allowed.has(item as string)) : [];
const day = (value: number | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : undefined;

/**
 * Where the person came from. `invited_by` means an Instant Access Pass, which
 * is a different acquisition story from a referral link, so they stay distinct.
 */
function originTag(member: MemberRow) {
  if (member.source === 'invitation' || member.invited_by) return 'signup-access-pass';
  if (member.waitlist_referrer_id) return 'signup-waitlist-referral';
  return member.source === 'popup' ? 'signup-website-popup' : 'signup-website-inline';
}

export function audienceState(member: MemberRow) {
  const preferences = parse(member.preferences);
  const platforms = list(preferences.platforms, PLATFORMS);
  const agents = list(preferences.agents, AGENTS);
  const priorities = list(preferences.priorities, PRIORITIES);
  const campaign = parse(member.campaign);
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

  const tags = [
    member.status === 'approved' ? 'jackalope-early-access' : 'jackalope-waitlist',
    member.waitlist_verified_at || member.verified_at ? 'jackalope-verified' : null,
    member.first_desktop_at ? 'jackalope-desktop-connected' : null,
    member.first_download_at ? 'jackalope-downloaded' : null,
    member.referral_count > 0 ? 'jackalope-referrer' : null,
    originTag(member),
    ...platforms.map((value) => `platform-${value}`),
    ...agents.map((value) => `agent-${value}`),
    ...priorities.map((value) => `wants-${value}`),
  ].filter((value): value is string => value !== null);

  // Attributes carry the open-ended values. Tags would explode on UTM strings,
  // and segments can filter attributes directly.
  const attributes = {
    signup_source: originTag(member).replace('signup-', ''),
    lifecycle: member.status === 'approved' ? 'early-access' : 'waitlist',
    utm_source: text(campaign.source),
    utm_medium: text(campaign.medium),
    utm_campaign: text(campaign.campaign),
    landing_page: text(campaign.landing),
    joined_on: day(member.created_at),
    approved_on: day(member.approved_at),
    desktop_connected_on: day(member.first_desktop_at),
    verified_referrals: member.referral_count,
    platforms: platforms.join(',') || undefined,
    agents: agents.join(',') || undefined,
  };

  return {
    tags: [...new Set(tags)].sort(),
    attributes: Object.fromEntries(
      Object.entries(attributes).filter(([, value]) => value !== undefined),
    ),
  };
}

/** Marketing consent is the only thing that puts someone on the list. */
export function audienceEligible(member: Pick<MemberRow, 'newsletter' | 'status'>) {
  return member.newsletter === 1 && member.status !== 'revoked';
}
