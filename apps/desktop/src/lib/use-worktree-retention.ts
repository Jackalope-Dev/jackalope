import { useEffect } from 'react';
import { useCompareStore } from '../stores/compareStore';
import { useExecutionStore } from '../stores/executionStore';
import { useProjectStore } from '../stores/projectStore';
import { retainedWorkspaces } from './compare-judge';
import { isTauriEnvironment } from './native/env';
import { invokeNative } from './native/transport';
import { FIRST_PASS_DELAY_MS, PASS_INTERVAL_MS, retentionDays } from './worktree-retention';

let running = false;

/**
 * One automatic cleanup pass over every project that turned it on. Task history is refreshed
 * first so the combine follow-ups this window retains are known; a failed refresh skips the
 * pass. The native side does every Git and safety check and logs what it removed.
 */
async function pass() {
  if (running) return;
  running = true;
  try {
    const projects = useProjectStore
      .getState()
      .projects.filter(
        (project) => !project.plainFolder && retentionDays(project.preferences) !== undefined,
      );
    if (!projects.length) return;
    const execution = useExecutionStore.getState();
    await execution.refresh();
    const { runs, drafts, error, loading } = useExecutionStore.getState();
    if (error || loading) return;
    const retained = [
      ...retainedWorkspaces(
        useCompareStore.getState().comparisons,
        runs,
        (taskId) => drafts[`reply:${taskId}`]?.prompt ?? '',
      ),
    ];
    for (const project of projects) {
      try {
        await invokeNative('worktree_retention_run', {
          projectPath: project.path,
          retentionDays: retentionDays(project.preferences),
          retained,
        });
      } catch (cause) {
        console.warn(`Automatic worktree cleanup skipped ${project.name}:`, cause);
      }
    }
  } finally {
    running = false;
  }
}

/** Runs automatic worktree cleanup well after startup, then hourly, while the app is open. */
export function useWorktreeRetention() {
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let interval: number | undefined;
    const first = window.setTimeout(() => {
      void pass();
      interval = window.setInterval(() => void pass(), PASS_INTERVAL_MS);
    }, FIRST_PASS_DELAY_MS);
    return () => {
      window.clearTimeout(first);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
}
