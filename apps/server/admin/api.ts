import { useEffect, useState } from 'react';

const errors: Record<string, string> = {
  origin_required: 'Refresh your private admin sign-in and try again.',
  access_not_configured: 'Email or early access is not configured. Recheck setup.',
  member_changed: 'This person’s access changed. Close this dialog and refresh people.',
  download_not_ready: 'The download is no longer ready. Close this dialog and recheck setup.',
  delivery_unavailable: 'This older email has no delivery reference. Check Sequenzy.',
  delivery_check_failed:
    'Could not check delivery. The last known status is unchanged; retry or check Sequenzy.',
  mail_not_configured: 'The email service is not configured.',
  mail_not_found: 'This email is no longer in the retained history.',
  changelog_unavailable:
    'Could not read the published changelog. Check the website deployment and service binding, then reload changes.',
  broadcast_rejected:
    'Sequenzy rejected the draft. Check the sender domain and audience list, then try again.',
};
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not complete the request. Try again.';
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', ...options });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Your admin session may have expired. Sign in again.');
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      errors[data.error] ||
        (response.status === 403
          ? 'Your admin session may have expired. Sign in again.'
          : 'Could not complete the request. Try again.'),
    );
  return data;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export function useResource<T>(url: string) {
  const [revision, setRevision] = useState(0);
  const key = `${url}|${revision}`;
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string;
    loading: boolean;
    updated: number;
  }>({ key, data: null, error: '', loading: true, updated: 0 });
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, data: null, error: '', loading: true, updated: 0 });
    void api<T>(url, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted)
          setState({ key, data, error: '', loading: false, updated: Date.now() });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({ key, data: null, error: message(error), loading: false, updated: 0 });
      },
    );
    return () => controller.abort();
  }, [url, key]);
  return {
    ...(state.key === key ? state : { data: null, error: '', loading: true, updated: 0 }),
    reload: () => setRevision((value) => value + 1),
  };
}

export interface Readiness {
  enabled: boolean;
  mailConfigured: boolean;
  download: 'available' | 'missing' | 'unknown' | 'unconfigured';
  version: string | null;
  distribution?: 'store';
}
export type Status = 'waiting' | 'approved' | 'revoked';
export interface Member {
  id: string;
  email: string;
  status: Status;
  created_at: number;
  approved_at: number | null;
  verified_at: number | null;
  invite_limit: number;
  preferences: string | null;
  referral_count: number;
  pending_referrals: number;
  waitlist_verified_at: number | null;
  position?: number;
  devices: number;
  accepted: number;
  mail_kind?: string;
  mail_state?: string;
  mail_attempts?: number;
  delivery_status?: string;
  newsletter?: number;
  newsletter_confirmed_at?: number;
  newsletter_synced_at?: number;
  newsletter_attempts?: number;
  campaign?: string;
}
export interface Mail {
  id: string;
  kind: string;
  state: string;
  created_at: number;
  attempts: number;
  delivery_status: string | null;
  delivery_checked_at: number | null;
  can_check: boolean;
}
export interface MemberDetail {
  member: Member;
  devices: { created_at: number; expires_at: number }[];
  invites: { status: string; count: number }[];
  mail: Mail[];
  feedback: null | {
    completed_at: number | null;
    enabled: boolean;
    active_days: number;
    opened_results: number;
    prompt_count: number;
    email_requested: boolean;
    next_prompt_at: number | null;
  };
}
export interface PeopleResponse {
  members: Member[];
  counts: { status: Status; count: number }[];
  hasMore: boolean;
}
export interface Summary {
  people: {
    total: number;
    waiting: number;
    approved: number;
    notSignedIn: number;
    notConnected: number;
    connected: number;
  };
  feedback: { status: string; count: number }[];
  mail: { needsAttention: number };
}
export interface Metric {
  day: string;
  version: string;
  channel: string;
  os: string;
  name: string;
  dimension: string;
  count: number;
}
export interface Overview {
  metrics: Metric[];
  versions: { version: string }[];
  truncated: boolean;
  coverage: string;
  retentionDays: number;
  ingestionEnabled: boolean;
  emailEnabled: boolean;
}
export interface Report {
  id: string;
  cursor: number;
  payload: string;
  received_at: number;
  status: string;
  email_state: string;
}
export interface Insights {
  totals: {
    responded: number;
    requested: number;
    approved: number | null;
    connected: number | null;
  };
  platforms: Count[];
  agents: Count[];
  priorities: Count[];
  sources: Count[];
}
export interface Count {
  label: string;
  count: number;
}
export interface Broadcast {
  configured: boolean;
  synced: number;
  tags: string[];
  entries: { id: string; title: string; date: string; description: string; status?: string }[];
}

export const date = (value?: number | null) =>
  value ? new Date(value).toLocaleString() : 'Not yet';
export const groupNames = {
  waiting: 'Waiting',
  approved: 'Approved',
  revoked: 'Revoked',
  all: 'Everyone',
};
export const displayName = (value: string) =>
  value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
export const audienceLabel = (value: string) =>
  (
    ({
      macos: 'macOS',
      windows: 'Windows',
      linux: 'Linux',
      codex: 'Codex',
      claude: 'Claude Code',
      opencode: 'OpenCode',
      grok: 'Grok',
      antigravity: 'Antigravity',
      cursor: 'Cursor',
      gemini: 'Gemini',
      other: 'Other',
      exploring: 'Still exploring',
      parallel: 'Parallel work',
      review: 'Code review',
      context: 'Project context',
      accounts: 'Agent accounts',
      recurring: 'Recurring work',
      remote: 'Remote access',
      'direct-or-unknown': 'Direct or unknown',
    }) as Record<string, string>
  )[value] || displayName(value);
export const mailNames: Record<string, string> = {
  feedback_request: 'Feedback invitation',
  waitlist: 'Waitlist confirmation',
  welcome: 'Approval email',
  login: 'Sign-in email',
  invite: 'Instant Access Pass',
  referral: 'Referral milestone',
  passes_ready: 'Passes ready',
  pass_claimed: 'Pass claimed',
  pass_expired: 'Pass reservation expired',
};
export const deliveryNames: Record<string, string> = {
  pending: 'Waiting at the email service',
  queued: 'Queued at the email service',
  sent: 'Sent by the email service',
  delivered: 'Accepted by the recipient’s mail server',
  opened: 'Provider recorded an open',
  clicked: 'Provider recorded a click',
  bounced: 'Bounced — check the email address',
  complained: 'Recipient reported spam',
  suppressed: 'Suppressed by the email service',
  failed: 'Delivery failed — check Sequenzy',
  deferred: 'Delivery delayed',
  unknown: 'Delivery status not recognized',
};
export function mailStatus(mail: {
  delivery_status?: string | null;
  state?: string;
  mail_state?: string;
  attempts?: number;
  mail_attempts?: number;
}) {
  if (mail.delivery_status) return deliveryNames[mail.delivery_status] || deliveryNames.unknown;
  const state = mail.state ?? mail.mail_state;
  if (state === 'queued') return 'Accepted by email service · delivery not checked';
  if (state === 'sending') return 'Handing off to email service';
  if (state === 'failed')
    return (mail.attempts ?? mail.mail_attempts ?? 0) >= 5
      ? 'Could not hand off email · retries exhausted'
      : 'Handoff failed · automatic retry pending';
  return state === 'pending' ? 'Waiting to send' : 'No email recorded';
}
