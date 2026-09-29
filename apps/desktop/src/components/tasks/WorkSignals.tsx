import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { WorkItem } from '../../lib/task-collection';
import { isActive } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useOpenWorkStore } from '../../stores/openWorkStore';
import {
  type ChangeStats,
  compactElapsed,
  isUnread,
  openSignalKey,
  signalKey,
  useNow,
  useWorkSignalsStore,
} from '../../stores/workSignalsStore';
import './work-signals.css';

/** Key of the work open in the main view. */
export function useOpenSignalKey() {
  const selectedRun = useExecutionStore((state) =>
    state.runs.find((run) => run.id === state.selectedId),
  );
  const session = useLiveSessionStore((state) => state.selectedId);
  const managed = useManagedTaskStore((state) => state.selectedId);
  return openSignalKey(selectedRun, session, managed);
}

/** Marks work read when it is opened and again when the user leaves it, and keeps it in the tabs. */
export function useTrackOpenWork() {
  const key = useOpenSignalKey();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const markSeen = useWorkSignalsStore.getState().markSeen;
    if (previous.current && previous.current !== key) markSeen(previous.current, false);
    if (key) {
      markSeen(key);
      useOpenWorkStore.getState().open(key);
    }
    previous.current = key;
  }, [key]);
}

export function useWorkSignals() {
  return useWorkSignalsStore(
    useShallow((state) => ({ seen: state.seen, since: state.since, unread: state.unread })),
  );
}

/**
 * Compact status for a work row: an unread dot, elapsed time while running and
 * the size of the change once there is one.
 */
export function WorkSignals({
  item,
  stats,
  unread,
}: {
  item: WorkItem;
  stats?: ChangeStats;
  unread: boolean;
}) {
  const running = item.run ? isActive(item.run) : false;
  const now = useNow(running);
  const elapsed = running && item.run ? compactElapsed(item.run.startedAt, now) : '';
  const changed = stats && stats.files > 0;
  if (!unread && !elapsed && !changed) return null;
  return (
    <span className="work-signals">
      {elapsed && (
        <span className="work-signal-time" title="Time since this attempt started">
          {elapsed}
        </span>
      )}
      {changed && (
        <span
          className="work-signal-diff"
          title={`${stats.files} ${stats.files === 1 ? 'file' : 'files'} changed`}
        >
          <span className="work-signal-added">+{stats.added}</span>
          <span className="work-signal-removed">−{stats.removed}</span>
        </span>
      )}
      {unread && (
        <span className="work-signal-unread" role="img" aria-label="Unread">
          <span aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

export { isUnread, signalKey };
