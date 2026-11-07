import { createTelemetry } from './telemetry.ts';

export const telemetry = createTelemetry(async (events) => {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('app_telemetry', { events });
});
