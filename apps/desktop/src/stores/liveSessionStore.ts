import { describeError } from '@jackalope/contracts/errors';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { type SessionSnapshot, sessionCommand } from '../lib/live-session';
import { isTauriEnvironment } from '../lib/native/env';
import { observeRefresh } from '../lib/observe-refresh';
import { knownSessionRevisions, mergeSessionChanges } from '../lib/session-changes';
import {
  loadReplyPages,
  REPLY_WINDOW,
  replyOmitted,
  type SessionReply,
  withReplies,
} from '../lib/session-replies';

interface SessionsState extends SessionSnapshot {
  selectedId: string | null;
  loading: boolean;
  refresh: (id?: string | null) => Promise<void>;
  select: (id: string | null) => void;
  /** Fills in replies a snapshot left out, such as older ones scrolling into view. */
  loadReplies: (sessionId: string, runIds: readonly string[]) => Promise<void>;
  /** Loads every reply of a conversation, for exports that need the whole text. */
  loadAllReplies: (sessionId: string) => Promise<void>;
  /** Occurrences of `query` in each reply of a conversation, counted natively. */
  searchReplies: (sessionId: string, query: string) => Promise<Record<string, number>>;
}
let refresh: Promise<void> | undefined;
let pendingId: string | null | undefined;
/** Replies being fetched, so rows scrolling past do not ask twice. */
const loading = new Set<string>();
export const useLiveSessionStore = create<SessionsState>((set, get) => ({
  sessions: [],
  runs: [],
  error: null,
  selectedId: null,
  loading: true,
  select: (selectedId) => {
    set({ selectedId });
    void get().refresh(selectedId);
  },
  refresh: (id = get().selectedId) => {
    if (refresh) {
      pendingId = id;
      return refresh.then(() => (pendingId !== undefined ? get().refresh(pendingId) : undefined));
    }
    pendingId = undefined;
    refresh = sessionCommand<SessionSnapshot>('snapshot', {
      id,
      known: knownSessionRevisions(get().revisions),
      // Older replies of the open conversation load as they are read.
      ...(id ? { replies: REPLY_WINDOW } : {}),
    })
      .then((snapshot) => {
        const current = get();
        const next = mergeSessionChanges(current, snapshot);
        if (
          !current.loading &&
          next.sessions === current.sessions &&
          next.runs === current.runs &&
          next.error === current.error
        )
          return;
        set({ ...next, loading: false });
      })
      .catch((error) => set({ error: describeError(error), loading: false }))
      .finally(() => {
        refresh = undefined;
      });
    return refresh;
  },
  loadReplies: (sessionId, runIds) => {
    const wanted = runIds.filter(
      (id) => !loading.has(id) && replyOmitted(get().runs.find((run) => run.id === id)),
    );
    if (!wanted.length) return Promise.resolve();
    for (const id of wanted) loading.add(id);
    return loadReplyPages(
      wanted,
      (ids) => sessionCommand<SessionReply[]>('results', { id: sessionId, runIds: ids }),
      (replies) => set((state) => ({ runs: withReplies(state.runs, replies) })),
    ).finally(() => {
      for (const id of wanted) loading.delete(id);
    });
  },
  loadAllReplies: async (sessionId) => {
    const session = get().sessions.find((item) => item.id === sessionId);
    const ids = new Set(session?.batches.map((batch) => batch.runId));
    const missing = () =>
      get()
        .runs.filter((run) => ids.has(run.id) && replyOmitted(run))
        .map((run) => run.id);
    await get().loadReplies(sessionId, missing());
    // Replies another row was already loading finish before the export reads them.
    while (missing().some((id) => loading.has(id)))
      await new Promise((resolve) => setTimeout(resolve, 50));
    await get().loadReplies(sessionId, missing());
    if (missing().length) throw new Error('Some replies could not be loaded. Try again.');
  },
  searchReplies: (sessionId, query) =>
    sessionCommand<Record<string, number>>('search', { id: sessionId, query }),
}));

export function observeLiveSessions(id?: string) {
  if (!isTauriEnvironment()) {
    useLiveSessionStore.setState({ loading: false });
    return;
  }
  return observeRefresh({
    refresh: () => useLiveSessionStore.getState().refresh(id),
    interval: () => (document.hidden ? 8000 : 1500),
    subscribe: (changed) => listen('live-sessions-changed', changed),
  });
}
