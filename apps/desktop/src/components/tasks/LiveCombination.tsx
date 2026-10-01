import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { InlineNotice } from '../ui/InlineNotice';

interface LiveCombinationView {
  runs: { taskId: string; files: number; added: number; removed: number }[];
  conflicts: { taskIds: [string, string]; paths: string[] }[];
  complete: boolean;
}

const REFRESH_MS = 10_000;

/** Whether the assignments' current, unintegrated work still merges, refreshed while agents run. */
export function LiveCombination({
  projectId,
  taskIds,
  titles,
  live,
}: {
  projectId: string;
  taskIds: string[];
  titles: Record<string, string>;
  live: boolean;
}) {
  const [view, setView] = useState<LiveCombinationView>();
  const key = taskIds.join(',');
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (!isTauriEnvironment() || ids.length < 2) return;
    let current = true;
    const load = () =>
      void nativeTask<LiveCombinationView>('coordination_live_combination', {
        projectId,
        taskIds: ids,
      })
        .then((next) => current && setView(next))
        .catch(() => current && setView(undefined));
    load();
    const timer = live ? window.setInterval(load, REFRESH_MS) : undefined;
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [projectId, key, live]);
  if (!view || view.runs.length < 2) return null;
  if (view.conflicts.length) {
    return (
      <InlineNotice tone="warning" className="managed-live-combination">
        {view.conflicts.slice(0, 3).map((conflict) => (
          <p key={conflict.taskIds.join()}>
            {titles[conflict.taskIds[0]] ?? 'One assignment'} and{' '}
            {titles[conflict.taskIds[1]] ?? 'another assignment'} changed{' '}
            {conflict.paths.slice(0, 3).join(', ')}
            {conflict.paths.length > 3 ? ` and ${conflict.paths.length - 3} more` : ''} in ways Git
            cannot merge. Both agents can see this through their peer tools.
          </p>
        ))}
      </InlineNotice>
    );
  }
  const working = view.runs.filter((run) => run.files > 0);
  if (!view.complete || working.length < 2) return null;
  const files = working.reduce((total, run) => total + run.files, 0);
  return (
    <p className="managed-live-combination task-muted" role="status">
      {files} changed {files === 1 ? 'file' : 'files'} across {working.length} assignments merge
      cleanly so far.
    </p>
  );
}
