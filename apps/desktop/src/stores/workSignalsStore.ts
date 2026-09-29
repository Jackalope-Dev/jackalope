import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WorkItem } from '../lib/task-collection';
import { isActive, nativeTask, type TaskRun } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';

export interface ChangeStats {
  files: number;
  added: number;
  removed: number;
}

interface WorkSignalsState {
  /** Work finished before this time is never reported as unread (first run of this feature). */
  since: string;
  seen: Record<string, string>;
  /** Work the user explicitly marked unread. */
  unread: Record<string, true>;
  stats: Record<string, { value: ChangeStats; key: string; checkedAt: number }>;
  /** Records a visit; opening (the default) also clears an explicit unread mark. */
  markSeen: (key: string, opened?: boolean) => void;
  markUnread: (key: string) => void;
}

export const useWorkSignalsStore = create<WorkSignalsState>()(
  persist(
    (set) => ({
      since: new Date().toISOString(),
      seen: {},
      unread: {},
      stats: {},
      markSeen: (key, opened = true) =>
        set((state) => {
          const unread = { ...state.unread };
          if (opened) delete unread[key];
          return { unread, seen: { ...state.seen, [key]: new Date().toISOString() } };
        }),
      markUnread: (key) => set((state) => ({ unread: { ...state.unread, [key]: true } })),
    }),
    {
      name: 'jackalope-work-signals-v1',
      partialize: (state) => ({ since: state.since, seen: state.seen, unread: state.unread }),
      merge: (saved, current) => {
        const value = saved as Partial<WorkSignalsState> | undefined;
        const seen: Record<string, string> = {};
        for (const [key, time] of Object.entries(value?.seen ?? {}))
          if (typeof time === 'string') seen[key] = time;
        // Keep the newest entries so the map stays bounded on long-lived profiles.
        const bounded = Object.fromEntries(
          Object.entries(seen)
            .sort((a, b) => b[1].localeCompare(a[1]))
            .slice(0, 2000),
        );
        return {
          ...current,
          since: typeof value?.since === 'string' ? value.since : current.since,
          seen: bounded,
          unread: Object.fromEntries(
            Object.keys(value?.unread ?? {}).map((key) => [key, true as const]),
          ),
        };
      },
    },
  ),
);

/** Stable identity for read state: a task, a chat or a managed plan. */
export function signalKey(item: WorkItem) {
  if (item.managed) return `managed:${item.managed.id}`;
  if (item.session) return `session:${item.session.id}`;
  return item.run?.taskId ?? item.id;
}

/** When the item last produced something worth reading. */
function activityTime(item: WorkItem) {
  const run = item.run;
  if (run?.prompts?.some((prompt) => prompt.status === 'pending')) return run.startedAt;
  return run?.endedAt ?? item.session?.updatedAt ?? item.date;
}

export function isUnread(
  item: WorkItem,
  signals: Pick<WorkSignalsState, 'seen' | 'since' | 'unread'>,
  openKey: string | null,
) {
  if (!item.run && !item.session && !item.managed) return false;
  const key = signalKey(item);
  if (key === openKey) return false;
  if (signals.unread[key]) return true;
  if (!['attention', 'review', 'finished'].includes(item.stage)) return false;
  const { seen, since } = signals;
  const time = activityTime(item);
  const seenAt = seen[key];
  return time > since && (!seenAt || time > seenAt);
}

/** The work key currently open in the main view, used to mark it read. */
export function openSignalKey(
  selectedRun: TaskRun | undefined,
  selectedSession: string | null,
  selectedManaged: string | null,
) {
  if (selectedManaged) return `managed:${selectedManaged}`;
  if (selectedSession) return `session:${selectedSession}`;
  return selectedRun?.taskId ?? null;
}

let pending: Promise<void> | null = null;

/**
 * Keeps change counts current for the given attempts: finished attempts are read
 * once per status change, running attempts at most every 15 seconds.
 */
export function useChangeStats(runs: (TaskRun | undefined)[]) {
  const stats = useWorkSignalsStore((state) => state.stats);
  const wanted = runs.filter((run): run is TaskRun => !!run?.workspace && !!run.baseHead);
  const signature = wanted.map((run) => `${run.id}:${run.status}:${run.endedAt ?? ''}`).join('|');
  const latest = useRef(wanted);
  latest.current = wanted;
  useEffect(() => {
    if (!isTauriEnvironment() || !signature) return;
    const refresh = () => {
      if (pending) return;
      const current = useWorkSignalsStore.getState().stats;
      const due = latest.current.filter((run) => {
        const entry = current[run.id];
        const key = `${run.status}:${run.endedAt ?? ''}`;
        return (
          !entry || entry.key !== key || (isActive(run) && Date.now() - entry.checkedAt > 15_000)
        );
      });
      if (!due.length) return;
      pending = nativeTask<Record<string, ChangeStats>>('task_change_stats', {
        ids: due.map((run) => run.id),
      })
        .then((result) => {
          const checkedAt = Date.now();
          useWorkSignalsStore.setState((state) => {
            const next = { ...state.stats };
            for (const run of due)
              if (result[run.id])
                next[run.id] = {
                  value: result[run.id],
                  key: `${run.status}:${run.endedAt ?? ''}`,
                  checkedAt,
                };
            return { stats: next };
          });
        })
        .catch(() => {})
        .finally(() => {
          pending = null;
        });
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [signature]);
  return stats;
}

/** A clock for elapsed-time labels; ticks only while something is running. */
export function useNow(active: boolean, interval = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [active, interval]);
  return now;
}

export function compactElapsed(since: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d`;
}
