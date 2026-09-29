import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskFollowUp } from '../../lib/task-followups';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { latestAttempt } from '../../lib/task-workflow';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';

// Follow-ups can be queued from other windows and the terminal, so the queue is
// polled; it only needs to feel live while work runs or something is queued.
const BUSY_POLL_MS = 1000;
const IDLE_POLL_MS = 5000;

/**
 * Follow-up queue for one task. Once a follow-up queued here starts, the view
 * moves to the new attempt if this attempt is still the one selected.
 */
export function useTaskFollowUps({
  run,
  draftKey,
  reply,
  canContinue,
  blocked,
  busy,
  onError,
}: {
  run: TaskRun;
  draftKey: string;
  reply: string;
  canContinue: boolean;
  /** Another action or submission is in flight. */
  blocked: boolean;
  /** The attempt is running, so the queue can drain at any moment. */
  busy: boolean;
  onError: (message: string) => void;
}) {
  const [followups, setFollowups] = useState<TaskFollowUp[]>([]);
  const [queueError, setQueueError] = useState('');
  const [queueing, setQueueing] = useState(false);
  const queueRequest = useRef<{ key: string; id: string } | null>(null);
  const queuedHere = useRef(false);
  const refresh = useExecutionStore((state) => state.refresh);
  const live = busy || followups.length > 0;

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let alive = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await nativeTask<TaskFollowUp[]>('task_followup_snapshot', {
          taskId: run.taskId,
        });
        if (alive) {
          setFollowups(value ?? []);
          setQueueError('');
          if (queuedHere.current && !value?.length) {
            await refresh();
            const state = useExecutionStore.getState();
            const next = latestAttempt(state.runs, run.taskId);
            if (
              alive &&
              queuedHere.current &&
              next &&
              next.id !== run.id &&
              state.selectedId === run.id
            ) {
              queuedHere.current = false;
              state.select(next.id);
            }
          }
        }
      } catch (cause) {
        if (alive) setQueueError(String(cause));
      } finally {
        pending = false;
      }
    };
    void load();
    const interval = setInterval(() => void load(), live ? BUSY_POLL_MS : IDLE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [run.id, run.taskId, refresh, live]);

  const queueFollowUp = useCallback(
    async (interrupt = false) => {
      if (!reply.trim() || blocked || queueing || !canContinue) return;
      setQueueing(true);
      onError('');
      const prompt = reply.trim();
      const { drafts, draft } = useExecutionStore.getState();
      const connectionIds = drafts[draftKey]?.connectionIds;
      const requestKey = JSON.stringify([run.id, prompt, connectionIds, interrupt]);
      if (queueRequest.current?.key !== requestKey)
        queueRequest.current = { key: requestKey, id: crypto.randomUUID() };
      try {
        await nativeTask('task_followup_queue', {
          id: queueRequest.current.id,
          runId: run.id,
          prompt,
          connectionIds: connectionIds ?? null,
          interrupt,
        });
        queuedHere.current = true;
        if (useExecutionStore.getState().drafts[draftKey]?.prompt.trim() === prompt)
          draft(draftKey, { prompt: '' });
        queueRequest.current = null;
        setFollowups(
          (await nativeTask<TaskFollowUp[]>('task_followup_snapshot', { taskId: run.taskId })) ??
            [],
        );
        await refresh();
      } catch (cause) {
        onError(String(cause));
      } finally {
        setQueueing(false);
      }
    },
    [reply, blocked, queueing, canContinue, onError, draftKey, run.id, run.taskId, refresh],
  );

  const updateFollowUp = useCallback(
    async (id: string, action: 'resume' | 'cancel') => {
      if (queueing) return;
      setQueueing(true);
      onError('');
      try {
        await nativeTask('task_followup_action', { id, action });
        if (action === 'resume') queuedHere.current = true;
        const remaining =
          (await nativeTask<TaskFollowUp[]>('task_followup_snapshot', { taskId: run.taskId })) ??
          [];
        if (action === 'cancel' && !remaining.length) queuedHere.current = false;
        setFollowups(remaining);
      } catch (cause) {
        onError(String(cause));
      } finally {
        setQueueing(false);
      }
    },
    [queueing, onError, run.taskId],
  );

  return { followups, queueError, queueing, queueFollowUp, updateFollowUp };
}
