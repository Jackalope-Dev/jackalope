import { describeError } from '@jackalope/contracts/errors';
import { create } from 'zustand';
import { isTauriEnvironment } from '../lib/native/env.ts';
import { invokeNative } from '../lib/native/transport.ts';

interface ActivityState {
  /** Schedule names by the attempt they started, from the ledger ScheduleNotice already reads. */
  schedules: Record<string, string>;
  /** Ports of running task previews by attempt. */
  previews: Record<string, number>;
  previewError: string | null;
  /** Reads the running previews once; callers refresh when the running work changes. */
  refreshPreviews: () => Promise<void>;
}

export const useActivityStore = create<ActivityState>((set) => ({
  schedules: {},
  previews: {},
  previewError: null,
  refreshPreviews: async () => {
    if (!isTauriEnvironment()) return;
    try {
      const { previews } = await invokeNative<{ previews: [string, number][] }>('desktop_activity');
      set({ previews: Object.fromEntries(previews), previewError: null });
    } catch (cause) {
      set({ previewError: describeError(cause) });
    }
  },
}));
