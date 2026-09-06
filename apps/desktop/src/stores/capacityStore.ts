import { create } from 'zustand';
import { nativeTask } from '../lib/task-runtime';

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
  /**
   * Reads the shared native capacity snapshot. `force` requests a live
   * re-check (subject to the backend's own 60s cooldown); without it, the
   * very first call in the app's lifetime still performs a real read, and
   * later calls just return whatever is already cached server-side. Shared
   * across every consumer so opening the Agents page after Usage (or vice
   * versa) never re-spawns the CLIs unnecessarily.
   */
  fetch: (force?: boolean) => Promise<void>;
}

export const useCapacityStore = create<CapacityState>((set, get) => ({
  records: [],
  loading: false,
  error: null,
  lastFetched: 0,
  fetch: async (force = false) => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const records = await nativeTask<CapacityRecord[]>('capacity_snapshot', { refresh: force });
      set({ records, lastFetched: Date.now() });
    } catch (cause) {
      set({ error: String(cause) });
    } finally {
      set({ loading: false });
    }
  },
}));

/** The account identity string for `agentId`'s last-known capacity record, if any has been fetched. */
export function accountForAgent(records: CapacityRecord[], agentId: string): string | null {
  return records.find((record) => record.agent === agentId)?.account ?? null;
}
