import type { FailureKind, TaskRun } from './run-types.ts';

/** How a provider limit stopped work: an allowance to wait out, a short rate window, or billing. */
export type UsageLimitKind = 'usage' | 'rate' | 'billing';

export interface UsageLimit {
  kind: UsageLimitKind;
  /** When the provider said the limit resets, in milliseconds; null when it did not say. */
  resetsAt: number | null;
  /** The provider's own wording, as the agent reported it. */
  message: string;
  agent: string;
  account: string;
  profileId: string | null;
}

const KINDS: Partial<Record<FailureKind, UsageLimitKind>> = {
  quota_exhausted: 'usage',
  rate_limited: 'rate',
  billing: 'billing',
};

/** The limit that stopped `run`, when a provider usage, rate or billing limit did. */
export function usageLimitOf(run: TaskRun | undefined | null): UsageLimit | null {
  const kind = run?.failureKind ? KINDS[run.failureKind] : undefined;
  if (!run || !kind || run.status !== 'failed') return null;
  const reported = run.quotaFailure?.resetsAt;
  return {
    kind,
    resetsAt: typeof reported === 'number' && reported > 0 ? reported * 1000 : null,
    message: run.error?.trim() || run.quotaFailure?.message || '',
    agent: run.accountBinding?.adapter ?? run.agent,
    account: run.accountBinding?.label || run.account,
    profileId: run.accountBinding?.profileId ?? null,
  };
}

const LIMIT_NAMES: Record<UsageLimitKind, string> = {
  usage: 'Usage limit',
  rate: 'Rate limit',
  billing: 'Billing limit',
};

export const limitName = (kind: UsageLimitKind) => LIMIT_NAMES[kind];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "3:40 PM", "tomorrow 9:05 AM", "Fri 9:00 AM" or "Dec 8, 9:00 AM", in the viewer's zone. */
export function resetTime(at: number, now: number) {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  if (sameDay(date, today)) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(date, tomorrow)) return `tomorrow ${time}`;
  if (at - now < 6 * 86_400_000)
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Time left until `at`: "2h 05m", "4m 09s", "12s"; "now" once it has passed. */
export function countdown(at: number, now: number) {
  const seconds = Math.ceil((at - now) / 1000);
  if (seconds <= 0) return 'now';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${pad(minutes)}m`;
  if (minutes) return `${minutes}m ${pad(rest)}s`;
  return `${rest}s`;
}

/**
 * The one-line report for lists and notices: "Usage limit — resets 3:40 PM". Matches the
 * native notification wording.
 */
export function limitHeadline(limit: Pick<UsageLimit, 'kind' | 'resetsAt'>, now: number) {
  if (limit.kind === 'billing') return 'Billing limit — add credit or switch account';
  const name = limitName(limit.kind);
  if (limit.resetsAt == null) return `${name} — reset time not reported`;
  if (limit.resetsAt <= now) return `${name} — reset at ${resetTime(limit.resetsAt, now)}`;
  return `${name} — resets ${resetTime(limit.resetsAt, now)}`;
}

/** An account a recent attempt found limited, shown as limited until its reset. */
export interface ObservedLimit extends UsageLimit {
  runId: string;
  observedAt: number;
}

/** Without a reported reset, a limit is shown for this long unless later work used the account. */
const UNREPORTED_LIMIT_MS = 12 * 3_600_000;

const accountKey = (run: TaskRun) =>
  `${run.accountBinding?.adapter ?? run.agent}:${run.accountBinding?.profileId ?? run.accountBinding?.directory ?? run.account}`;

/**
 * Accounts that recent attempts found limited and that are still limited at `now`: until
 * the reported reset, or, when none was reported, until a later attempt on the same
 * account starts or twelve hours pass. Limits passed on to another account by a quota
 * handoff count too. Billing limits are left out; they do not end with time.
 */
export function observedLimits(runs: TaskRun[], now: number): ObservedLimit[] {
  const latestStart = new Map<string, number>();
  for (const run of runs) {
    const key = accountKey(run);
    const started = Date.parse(run.startedAt);
    if (Number.isFinite(started) && started > (latestStart.get(key) ?? 0))
      latestStart.set(key, started);
  }
  const found = new Map<string, ObservedLimit>();
  const consider = (limit: ObservedLimit, key: string) => {
    if (limit.kind === 'billing') return;
    const current = limit.resetsAt
      ? limit.resetsAt > now
      : now - limit.observedAt < UNREPORTED_LIMIT_MS &&
        (latestStart.get(key) ?? 0) <= limit.observedAt;
    const known = found.get(key);
    if (current && (!known || limit.observedAt > known.observedAt)) found.set(key, limit);
  };
  for (const run of runs) {
    const limit = usageLimitOf(run);
    const observedAt = Date.parse(run.endedAt ?? run.startedAt);
    if (limit && Number.isFinite(observedAt))
      consider({ ...limit, runId: run.id, observedAt }, accountKey(run));
    for (const handoff of run.routing?.handoffs ?? []) {
      const at = handoff.failure.resetsAt;
      const recorded = Date.parse(handoff.recordedAt);
      if (!Number.isFinite(recorded)) continue;
      const binding = handoff.binding;
      consider(
        {
          kind: 'usage',
          resetsAt: typeof at === 'number' && at > 0 ? at * 1000 : null,
          message: handoff.failure.message,
          agent: binding.adapter,
          account: binding.label,
          profileId: binding.profileId,
          runId: run.id,
          observedAt: recorded,
        },
        `${binding.adapter}:${binding.profileId ?? binding.directory}`,
      );
    }
  }
  return [...found.values()].sort(
    (a, b) => (a.resetsAt ?? Number.MAX_SAFE_INTEGER) - (b.resetsAt ?? Number.MAX_SAFE_INTEGER),
  );
}
