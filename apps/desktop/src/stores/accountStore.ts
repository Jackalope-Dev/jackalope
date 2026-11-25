import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountStatus, SuggestionState } from '../lib/account';
import { openSettings } from '../lib/app-events';
import { isTauriEnvironment } from '../lib/native/env';
import { invokeNative } from '../lib/native/transport';

/**
 * Native commands reject with the message the Rust side produced. Those
 * messages name the actual recovery step — reconnecting, unlocking a keychain,
 * freeing a device slot — so they must reach the user instead of being
 * replaced by generic advice that may not apply.
 */
export function nativeMessage(cause: unknown): string {
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object') {
    const value = cause as { message?: unknown; error?: unknown };
    if (typeof value.message === 'string') return value.message;
    if (typeof value.error === 'string') return value.error;
    try {
      return JSON.stringify(cause);
    } catch {
      return '';
    }
  }
  return '';
}

const UNAVAILABLE: AccountStatus = {
  state: 'unavailable',
  email: null,
  userCode: null,
  expiresAt: null,
};
/** Background reads reuse a status this recent; account actions always refresh it. */
const FRESH_MS = 60_000;

interface AccountState {
  status: AccountStatus | null;
  error: string;
  checkedAt: number;
  connecting: boolean;
  /** Reads the connection, checking it with the service; reuses a fresh status unless forced. */
  load: (force?: boolean) => Promise<AccountStatus | null>;
  update: (status: AccountStatus) => void;
  setError: (error: string) => void;
  /** Starts a connection in the browser and shows its code in Settings → Jackalope account. */
  connect: () => Promise<void>;
}

let loading: Promise<AccountStatus | null> | undefined;

export const useAccountStore = create<AccountState>((set, get) => ({
  status: null,
  error: '',
  checkedAt: 0,
  connecting: false,
  load: (force = false) => {
    if (loading) return loading;
    if (!isTauriEnvironment()) {
      set({ status: UNAVAILABLE, checkedAt: Date.now() });
      return Promise.resolve(UNAVAILABLE);
    }
    if (!force && get().status && Date.now() - get().checkedAt < FRESH_MS)
      return Promise.resolve(get().status);
    loading = invokeNative<AccountStatus>('app_account_status')
      .then((status) => {
        set({ status, error: '', checkedAt: Date.now() });
        return status;
      })
      .catch((cause) => {
        set({
          error: nativeMessage(cause) || 'Could not read your account connection. Please retry.',
          checkedAt: Date.now(),
        });
        return get().status;
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  },
  update: (status) => set({ status, error: '', checkedAt: Date.now() }),
  setError: (error) => set({ error }),
  connect: async () => {
    if (get().connecting) return;
    set({ connecting: true, error: '' });
    try {
      get().update(await invokeNative<AccountStatus>('app_account_connect'));
      openSettings('Jackalope account');
    } catch (cause) {
      set({
        error: nativeMessage(cause) || 'Could not start the connection. Please retry.',
      });
    } finally {
      set({ connecting: false });
    }
  },
}));

const DAY_MS = 86_400_000;
/** "Not now" brings the suggestion back once, after this long. */
const SUGGESTION_SNOOZE_MS = 7 * DAY_MS;

interface AccountPromptState {
  /** When the person chose to continue without an account on the welcome screen. */
  skippedAt: number | null;
  /** The first local day Jackalope was opened, to recognize a second day of use. */
  firstDay: string | null;
  returned: boolean;
  suggestion: SuggestionState;
  snoozedUntil: number;
  /** Not saved: a suggestion left unanswered stays for this launch only. */
  shownThisLaunch: boolean;
  skip: () => void;
  /** Records today's use; a later day marks a returning person. */
  visit: (today: string) => void;
  markShown: () => void;
  snooze: () => void;
  dismiss: () => void;
}

/** Explicit choices about account prompts, remembered so a dismissed one never returns. */
export const useAccountPromptStore = create<AccountPromptState>()(
  persist(
    (set, get) => ({
      skippedAt: null,
      firstDay: null,
      returned: false,
      suggestion: 'unseen',
      snoozedUntil: 0,
      shownThisLaunch: false,
      skip: () => set({ skippedAt: Date.now() }),
      visit: (today) => {
        const { firstDay, returned } = get();
        if (!firstDay) set({ firstDay: today });
        else if (!returned && firstDay !== today) set({ returned: true });
      },
      markShown: () => {
        if (get().suggestion !== 'dismissed') set({ suggestion: 'shown', shownThisLaunch: true });
      },
      snooze: () =>
        set((state) => ({
          // A second "later" retires the suggestion: it comes back at most once.
          suggestion: state.snoozedUntil ? 'dismissed' : 'snoozed',
          snoozedUntil: Date.now() + SUGGESTION_SNOOZE_MS,
        })),
      dismiss: () => set({ suggestion: 'dismissed' }),
    }),
    {
      name: 'jackalope-account-prompts-v1',
      partialize: ({ skippedAt, firstDay, returned, suggestion, snoozedUntil }) => ({
        skippedAt,
        firstDay,
        returned,
        suggestion,
        snoozedUntil,
      }),
    },
  ),
);
