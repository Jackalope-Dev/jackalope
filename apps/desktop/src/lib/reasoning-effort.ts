/** Provider effort levels a composer can ask for; the native side checks the same set. */
const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const LABELS: Record<ReasoningEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

export function effortLabel(level: ReasoningEffort) {
  return LABELS[level];
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** A level remembered for a composer, or null when none was chosen or it is unreadable. */
export function savedEffort(key: string): ReasoningEffort | null {
  try {
    const value = localStorage.getItem(key);
    return isReasoningEffort(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveEffort(key: string, value: ReasoningEffort | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // The choice still applies to this composer; only remembering it is lost.
  }
}

/**
 * How full the context is, from what the provider reported: a share of the window when
 * it stated one. `null` when nothing was reported.
 */
export function contextShare(context: { used: number; window?: number | null } | null | undefined) {
  if (!context || !(context.used > 0)) return null;
  const window = context.window && context.window > 0 ? context.window : null;
  const share = window ? Math.min(1, context.used / window) : null;
  const level =
    share === null ? 'normal' : share >= 0.9 ? 'full' : share >= 0.7 ? 'high' : 'normal';
  return { used: context.used, window, share, level } as const;
}

export function compactTokens(value: number) {
  if (value < 1000) return `${value}`;
  if (value < 1_000_000) return `${Math.round(value / 100) / 10}k`.replace('.0k', 'k');
  return `${Math.round(value / 100_000) / 10}M`.replace('.0M', 'M');
}
