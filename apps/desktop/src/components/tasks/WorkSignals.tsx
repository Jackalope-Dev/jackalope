import { FileDiff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isActive } from '../../lib/run-status';
import type { WorkItem } from '../../lib/task-collection';
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

export const changeSummary = (stats: ChangeStats) =>
  `+${stats.added} −${stats.removed} in ${stats.files} ${stats.files === 1 ? 'file' : 'files'}`;

/** The size of a change, for headers with room for it. */
export function ChangeSize({ stats }: { stats: ChangeStats }) {
  return (
    <span className="work-signal-diff" title={changeSummary(stats)}>
      <span className="work-signal-added">+{stats.added}</span>
      <span className="work-signal-removed">−{stats.removed}</span>
      <span className="work-signal-files">
        {stats.files} {stats.files === 1 ? 'file' : 'files'}
      </span>
    </span>
  );
}

/**
 * Status for a work row: an unread dot, elapsed time while running and the size of the
 * change once there is one. `compact` rows keep their width for the title: they show
 * only a mark for finished work whose changes have not landed, with the size in its label.
 */
export function WorkSignals({
  item,
  stats,
  unread,
  compact = false,
}: {
  item: WorkItem;
  stats?: ChangeStats;
  unread: boolean;
  compact?: boolean;
}) {
  const running = item.run ? isActive(item.run) : false;
  const now = useNow(running && !compact);
  const elapsed = running && !compact && item.run ? compactElapsed(item.run.startedAt, now) : '';
  const changed = !!stats && stats.files > 0;
  const unlanded = compact && changed && !running && item.stage !== 'finished';
  if (!unread && !elapsed && !(compact ? unlanded : changed)) return null;
  return (
    <span className="work-signals">
      {elapsed && (
        <span className="work-signal-time" title="Time since this attempt started">
          {elapsed}
        </span>
      )}
      {stats && unlanded && (
        <span
          className="work-signal-unlanded"
          role="img"
          aria-label={`Changes not merged yet, ${changeSummary(stats)}`}
        >
          <FileDiff size={13} aria-hidden="true" />
        </span>
      )}
      {stats && changed && !compact && (
        <span className="work-signal-diff" title={changeSummary(stats)}>
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
