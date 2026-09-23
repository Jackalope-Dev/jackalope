import { create } from 'zustand';
import { nativeTask } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';

interface ReferralInvite {
  id: string;
  email: string;
  status: 'pending' | 'accepted';
  expiresAt: number;
  acceptedAt: number | null;
  downloadedAt: number | null;
  connectedAt: number | null;
}
export interface ReferralView {
  limit: number;
  remaining: number;
  accepted: number;
  downloaded: number;
  connected: number;
  shareUrl: string;
  invites: ReferralInvite[];
}

let pending: Promise<void> | undefined;
let generation = 0;
export const useReferralStore = create<{
  referrals: ReferralView | null;
  loading: boolean;
  error: string;
  checkedAt: number;
  load: (force?: boolean) => Promise<void>;
  clear: () => void;
}>((set, get) => ({
  referrals: null,
  loading: false,
  error: '',
  checkedAt: 0,
  clear: () => {
    generation++;
    pending = undefined;
    set({ referrals: null, checkedAt: 0, error: '', loading: false });
  },
  load: (force = true) => {
    if (pending) return pending;
    if (!force && Date.now() - get().checkedAt < (get().error ? 60_000 : 300_000))
      return Promise.resolve();
    if (!isTauriEnvironment()) {
      set({ error: 'Open the desktop app to manage invitations.' });
      return Promise.resolve();
    }
    const version = generation;
    set({ loading: true, error: '' });
    pending = nativeTask<ReferralView>('app_account_referrals')
      .then((referrals) => {
        if (!referrals || !Number.isInteger(referrals.remaining) || referrals.remaining < 0)
          throw new Error('Invitation allowance unavailable.');
        if (version === generation) set({ referrals, checkedAt: Date.now() });
      })
      .catch((cause) => {
        if (version === generation)
          set({ referrals: null, error: String(cause), checkedAt: Date.now() });
      })
      .finally(() => {
        if (version === generation) {
          pending = undefined;
          set({ loading: false });
        }
      });
    return pending;
  },
}));
