import { telemetry, useCommunityStore } from '../stores/communityStore';
import { useExecutionStore } from '../stores/executionStore';
import { useUpdateStore } from '../stores/updateStore';
import type { TaskState } from './telemetry';

export function observeTelemetry() {
  let baseline = useExecutionStore.getState();
  const stopRuns = useExecutionStore.subscribe((next) => {
    const prior = baseline;
    baseline = next;
    if (prior.loading || next.loading || !useCommunityStore.getState().settings?.reviewed) return;
    const previous = new Map(prior.runs.map((run) => [run.id, run]));
    for (const run of next.runs) {
      const old = previous.get(run.id);
      if (!old) telemetry.track({ name: 'task_state', state: 'starting' });
      if (
        old?.status !== run.status &&
        ['running', 'review', 'reviewed', 'failed', 'stopped', 'interrupted'].includes(run.status)
      )
        telemetry.track({ name: 'task_state', state: run.status as TaskState });
      if (old?.status !== run.status && run.status === 'failed')
        telemetry.track({ name: 'app_error', code: 'task_failed' });
      if (run.persistenceError && !old?.persistenceError)
        telemetry.track({ name: 'app_error', code: 'history_save_failed' });
      if (
        run.verification &&
        !run.verification.result.success &&
        old?.verification?.result.success !== false
      )
        telemetry.track({ name: 'app_error', code: 'verification_failed' });
    }
  });
  const stopUpdates = useUpdateStore.subscribe((next, previous) => {
    if (next.error && !previous.error)
      telemetry.track({ name: 'app_error', code: 'update_failed' });
  });
  const uiError = () => telemetry.track({ name: 'app_error', code: 'ui_error' });
  window.addEventListener('error', uiError);
  window.addEventListener('unhandledrejection', uiError);
  return () => {
    stopRuns();
    stopUpdates();
    window.removeEventListener('error', uiError);
    window.removeEventListener('unhandledrejection', uiError);
  };
}
