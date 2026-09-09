import { create } from 'zustand';
import { nativeTask } from '../lib/task-runtime.ts';

export interface CapacityWindow {
  poolId: string;
  poolName: string;
  window: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  durationMinutes: number | null;
  resetsAt: number | null;
}

export interface CapacityRecord {
  agent: string;
  status: string;
  account: string;
  source: string;
  observedAt: string | null;
  detail: string;
  windows: CapacityWindow[];
}

interface CapacityState {
  records: CapacityRecord[];
  loading: boolean;
  error: string | null;
  lastFetched: number;
  lastAttempted: number;
  fetch: (force?: boolean) => Promise<void>;
}

export const CAPACITY_CACHE_MS = 5 * 60_000;
let inFlight: Promise<void> | undefined;

export const useCapacityStore = create<CapacityState>((set, get) => ({
  records: [],
  loading: false,
  error: null,
  lastFetched: 0,
  lastAttempted: 0,
  fetch: (force = false) => {
    if (inFlight) return inFlight;
    const { lastFetched, lastAttempted, error } = get();
    const now = Date.now();
    if (
      !force &&
      ((lastFetched > 0 && now - lastFetched < CAPACITY_CACHE_MS) ||
        (error && now - lastAttempted < 60_000))
    )
      return Promise.resolve();
    set({ loading: true, error: null, lastAttempted: now });
    inFlight = Promise.resolve().then(async () => {
      try {
        const records = await nativeTask<CapacityRecord[]>('capacity_snapshot', { refresh: true });
        set({ records, lastFetched: Date.now() });
      } catch (cause) {
        set({ error: String(cause) });
      } finally {
        inFlight = undefined;
        set({ loading: false });
      }
    });
    return inFlight;
  },
}));

/** The account identity string for `agentId`'s last-known capacity record, if any has been fetched. */
export function accountForAgent(records: CapacityRecord[], agentId: string): string | null {
  return records.find((record) => record.agent === agentId)?.account ?? null;
}
