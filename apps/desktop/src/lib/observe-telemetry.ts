import { telemetry, useCommunityStore } from '../stores/communityStore';
import { useExecutionStore } from '../stores/executionStore';
import { useUpdateStore } from '../stores/updateStore';
import { createTaskTelemetry } from './task-telemetry';

const observeTasks = createTaskTelemetry(telemetry.track);

export function observeTelemetry() {
  const stopRuns = useExecutionStore.subscribe((next, prior) => {
    const settings = useCommunityStore.getState().settings;
    observeTasks(next.runs, !!settings?.reviewed && settings.telemetry && settings.configured);
    if (next.historyError && !prior.historyError)
      telemetry.track({ name: 'app_error', code: 'history_load_failed' });
    if (next.discoveryError && !prior.discoveryError)
      telemetry.track({ name: 'app_error', code: 'agent_discovery_failed' });
  });
  const stopUpdates = useUpdateStore.subscribe((next, previous) => {
    if (next.error && !previous.error)
      telemetry.track({ name: 'app_error', code: 'update_failed' });
  });
  const stopUi = observeUiTelemetry();
  return () => {
    stopRuns();
    stopUpdates();
    stopUi();
  };
}

export function observeUiTelemetry() {
  const uiError = () => telemetry.track({ name: 'app_error', code: 'ui_error' });
  const rejection = () => telemetry.track({ name: 'app_error', code: 'ui_rejection' });
  const hidden = () => {
    if (document.hidden) void telemetry.flush();
  };
  window.addEventListener('error', uiError);
  window.addEventListener('unhandledrejection', rejection);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    window.removeEventListener('error', uiError);
    window.removeEventListener('unhandledrejection', rejection);
    document.removeEventListener('visibilitychange', hidden);
  };
}
