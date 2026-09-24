import {
  CAPACITY_CACHE_MS,
  type CapacityRecord,
  type CapacityWindow,
} from '../stores/capacityStore';

export function capacityWindowName(window: CapacityWindow) {
  if (window.window === 'weekly') return 'Weekly allowance';
  if (window.window === 'monthly') return 'Monthly allowance';
  if (window.window === 'billing') return 'Included allowance';
  const minutes = window.durationMinutes;
  if (!minutes) {
    if (window.window === 'primary') return 'Primary window';
    if (window.window === 'secondary') return 'Secondary window';
    return 'Usage window';
  }
  if (minutes % 1440 === 0) return `${minutes / 1440}-day window`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
  return `${minutes}-minute window`;
}

export function capacityWindowDisplay(record: CapacityRecord, window: CapacityWindow, now: number) {
  const observed = Date.parse(record.observedAt ?? '');
  const expired = window.resetsAt !== null && window.resetsAt * 1000 <= now;
  const stale = !Number.isFinite(observed) || now - observed > CAPACITY_CACHE_MS;
  if (expired || stale || record.status === 'stale') {
    return { remaining: null, label: 'Refresh needed', tone: 'unknown' } as const;
  }
  const remaining = window.remainingPercent;
  if (record.status !== 'reported' || remaining === null || !Number.isFinite(remaining)) {
    return { remaining: null, label: 'Not reported', tone: 'unknown' } as const;
  }
  const bounded = Math.min(100, Math.max(0, remaining));
  const percent = bounded.toLocaleString(undefined, {
    maximumFractionDigits: bounded < 10 ? 1 : 0,
  });
  return {
    remaining: bounded,
    label: `${percent}% remaining`,
    tone: bounded === 0 ? 'empty' : bounded <= 20 ? 'low' : 'available',
  } as const;
}
