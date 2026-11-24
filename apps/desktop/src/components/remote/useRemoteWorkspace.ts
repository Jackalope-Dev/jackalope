import { describeError } from '@jackalope/contracts/errors';
import {
  draftKey as itemDraftKey,
  latestTasks,
  prepareRemoteRequest,
  type RemoteAction,
  type RemoteRequest,
  type RemoteTask,
  requestKey,
  type Snapshot,
  waitingSessions,
} from '@jackalope/contracts/remote';
import type { Review } from '@jackalope/contracts/runs';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A paired host's work as the companion screens show it: the polled snapshot, the
 * selected task or conversation with its detail and review, and the actions on them.
 * Drafts are kept per item in local storage, and sends carry a saved request id so a
 * retried send after a lost response is not run twice.
 */
export function useRemoteWorkspace(
  request: RemoteRequest,
  storageKey: string,
  initial?: { selected?: string; composing?: boolean },
) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState(initial?.selected ?? '');
  const [detail, setDetail] = useState<RemoteTask | null>(null);
  const [projectId, setProjectId] = useState('');
  const [loadedReview, setReview] = useState<{ runId: string; value: Review } | null>(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [status, setStatus] = useState('Connecting…');
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(initial?.composing ?? false);
  const [draft, setDraft] = useState('');
  const inFlight = useRef(false);
  const revision = useRef(0);
  const selectedSession = snapshot?.sessions.find((s) => s.id === selected);
  const latest = latestTasks(snapshot);
  const selectedTask = snapshot?.tasks.find((task) => (task.sessionId || task.taskId) === selected);
  const review = loadedReview?.runId === selectedTask?.id ? loadedReview?.value : null;
  const draftKey = itemDraftKey(storageKey, composing ? { newWork: true } : selected);
  const legacyDraftKey =
    selectedTask && !selectedTask.sessionId && !composing
      ? itemDraftKey(storageKey, selectedTask.id)
      : undefined;
  useEffect(() => {
    try {
      let saved = localStorage.getItem(draftKey);
      if (saved === null && legacyDraftKey) {
        const legacy = legacyDraftKey;
        saved = localStorage.getItem(legacy);
        if (saved !== null && legacy !== draftKey) {
          localStorage.setItem(draftKey, saved);
          const receipt = localStorage.getItem(requestKey(legacy));
          if (receipt) localStorage.setItem(requestKey(draftKey), receipt);
          localStorage.removeItem(legacy);
          localStorage.removeItem(requestKey(legacy));
        }
      }
      setDraft(saved ?? '');
    } catch {
      setDraft('');
      setError('Draft storage is unavailable. Keep this view open until you send your message.');
    }
  }, [draftKey, legacyDraftKey]);
  const editDraft = (value: string) => {
    setDraft(value);
    try {
      if (value) localStorage.setItem(draftKey, value);
      else localStorage.removeItem(draftKey);
    } catch {
      setError('This draft could not be saved. Keep this view open until you send it.');
    }
  };
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const next = await request<Snapshot>({ action: 'snapshot' });
      const run = next.tasks.find((task) => (task.sessionId || task.taskId) === selected);
      const loaded = run ? await request<RemoteTask>({ action: 'detail', runId: run.id }) : null;
      if (revision.current !== current) return;
      setSnapshot(next);
      setDetail(loaded);
      setStatus('Connected');
      setConnectionError('');
    } catch (cause) {
      if (revision.current === current) {
        setStatus('Disconnected');
        setConnectionError(describeError(cause));
      }
    }
  }, [request, selected]);
  useEffect(() => {
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === 'visible') await refresh();
      if (!canceled) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => {
      canceled = true;
      clearTimeout(timer);
      revision.current++;
    };
  }, [refresh]);
  const act = async (action: RemoteAction) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await request(action);
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const submit = async () => {
    if (inFlight.current || !draft.trim()) return;
    const text = draft.trim();
    if ([...text].length > 12000) {
      setError('Shorten this message to 12,000 characters. Your draft is saved.');
      return;
    }
    let action: RemoteAction = composing
      ? { action: 'start', projectId: projectId || snapshot?.projects[0]?.id, text }
      : {
          action: 'followup',
          sessionId: selectedSession?.id || selectedTask?.sessionId || undefined,
          runId: selectedSession?.id || selectedTask?.sessionId ? undefined : selectedTask?.id,
          text,
        };
    try {
      action = prepareRemoteRequest(localStorage, requestKey(draftKey), action);
    } catch {
      setError(
        'Could not save this send request. Free browser storage before retrying; nothing was sent.',
      );
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await request<{ sessionId?: string }>(action);
      editDraft('');
      try {
        localStorage.removeItem(requestKey(draftKey));
      } catch {
        setError('Message sent. This browser could not clear its saved request.');
      }
      if (response.sessionId) {
        setSelected(response.sessionId);
        setComposing(false);
      }
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const loadReview = async () => {
    if (inFlight.current || !selectedTask) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const runId = selectedTask.id;
    try {
      const next = await request<Review>({ action: 'review', runId });
      setReview({ runId, value: next });
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const answer = async (runId: string, promptId: string, text: string) => {
    await request({ action: 'answer', runId, promptId, text });
    await refresh();
  };
  const choose = (id: string) => {
    if (inFlight.current) return;
    setSelected(id);
    setComposing(false);
    setReview(null);
    setDetail(null);
    setError('');
  };
  const compose = () => {
    setComposing(true);
    setReview(null);
  };
  /** Leaves the open item or new-work form for the list. */
  const close = () => {
    if (inFlight.current) return;
    setSelected('');
    setComposing(false);
    setReview(null);
    setDetail(null);
    setError('');
  };
  const currentDetail = detail && detail.id === selectedTask?.id ? detail : null;
  return {
    snapshot,
    status,
    error,
    setError,
    connectionError,
    busy,
    selected,
    selectedTask,
    selectedSession,
    currentDetail,
    review,
    closeReview: () => setReview(null),
    latestTasks: latest,
    waitingSessions: waitingSessions(snapshot, latest),
    composing,
    projectId,
    setProjectId,
    draft,
    editDraft,
    refresh,
    act,
    submit,
    loadReview,
    answer,
    choose,
    compose,
    close,
  };
}
