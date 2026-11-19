/** What the phone knows across its computers; the mascot's mood comes only from this. */
export interface Activity {
  needsYou: number;
  working: number;
  /** Paired computers this phone can't reach right now. */
  unreachable: string[];
  /** Paired computers, reachable or not. */
  computers: number;
  loading: boolean;
}

export type Mood = 'waiting' | 'working' | 'offline' | 'idle';

/** Needs you outranks work in progress; nothing reachable reads as offline. */
export function mood(activity: Activity): Mood {
  if (activity.needsYou) return 'waiting';
  if (activity.working) return 'working';
  if (activity.computers && activity.unreachable.length === activity.computers) return 'offline';
  return 'idle';
}

/** One plain line under the title, from the same counts as the mood. */
export function headline(activity: Activity) {
  if (activity.loading) return 'Checking your computers…';
  const parts = [
    activity.needsYou && `${activity.needsYou} need${activity.needsYou === 1 ? 's' : ''} you`,
    activity.working && `${activity.working} working`,
  ].filter(Boolean);
  if (activity.computers && activity.unreachable.length === activity.computers)
    return activity.unreachable.length === 1
      ? `Can't reach ${activity.unreachable[0]}`
      : "Can't reach your computers";
  return parts.length ? parts.join(' · ') : 'All caught up';
}
