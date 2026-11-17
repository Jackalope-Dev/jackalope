import { describeError } from '@jackalope/contracts/errors';
import type { Snapshot } from '@jackalope/contracts/remote';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Host, request } from './native';

export interface ComputerState {
  /** The last list this computer returned; kept while it is unreachable. */
  snapshot: Snapshot | null;
  error: string;
  /** When this phone last heard from it (ISO), kept across launches. */
  lastSeen?: string;
}

const POLL_MS = 4000;
const LAST_SEEN_KEY = 'jackalope-companion-last-seen-v1';

/** Last contact per computer id; storage can be unavailable, which only loses the time. */
function readLastSeen(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function rememberLastSeen(id: string, at: string, paired: Set<string>) {
  try {
    const kept = Object.entries(readLastSeen()).filter(([host]) => paired.has(host));
    localStorage.setItem(LAST_SEEN_KEY, JSON.stringify({ ...Object.fromEntries(kept), [id]: at }));
  } catch {
    // Without storage only the last-seen time is lost.
  }
}

/**
 * Every paired computer's work, each polled on its own so one unreachable computer never
 * holds up the rest. Polling stops while `active` is false (a single computer's screen
 * polls for itself) and resumes immediately when the app returns to the foreground.
 */
export function useComputers(hosts: Host[], active: boolean) {
  const [computers, setComputers] = useState<Record<string, ComputerState>>({});
  // A poll and a foreground refresh can overlap; only the latest request per computer
  // lands, so an older response never replaces a newer one.
  const latest = useRef(new Map<string, number>());
  const paired = useRef(new Set<string>());
  paired.current = new Set(hosts.map((host) => host.id));
  const load = useCallback(async (host: Host) => {
    const sequence = (latest.current.get(host.id) ?? 0) + 1;
    latest.current.set(host.id, sequence);
    const settle = (next: (current?: ComputerState) => ComputerState) => {
      if (latest.current.get(host.id) !== sequence || !paired.current.has(host.id)) return;
      setComputers((current) => ({ ...current, [host.id]: next(current[host.id]) }));
    };
    try {
      const snapshot = await request<Snapshot>(host.id, { action: 'snapshot' });
      const at = new Date().toISOString();
      settle(() => ({ snapshot, error: '', lastSeen: at }));
      rememberLastSeen(host.id, at, paired.current);
    } catch (cause) {
      settle((current) => ({
        snapshot: current?.snapshot ?? null,
        error: describeError(cause),
        lastSeen: current?.lastSeen ?? readLastSeen()[host.id],
      }));
    }
  }, []);
  const refresh = useCallback(() => Promise.all(hosts.map((host) => load(host))), [hosts, load]);
  useEffect(() => {
    const ids = new Set(hosts.map((host) => host.id));
    setComputers((current) => {
      const kept = Object.entries(current).filter(([id]) => ids.has(id));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }, [hosts]);
  useEffect(() => {
    if (!active) return;
    let canceled = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const loops = hosts.map((host) => {
      const poll = async () => {
        if (document.visibilityState === 'visible') await load(host);
        if (!canceled) timers.set(host.id, setTimeout(poll, POLL_MS));
      };
      return poll;
    });
    for (const poll of loops) void poll();
    const resume = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', resume);
    return () => {
      canceled = true;
      for (const timer of timers.values()) clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [active, hosts, load, refresh]);
  return { computers, retry: load };
}
