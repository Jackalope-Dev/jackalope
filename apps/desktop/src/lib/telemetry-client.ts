import { observeOperation, telemetryOperation } from './operation-telemetry.ts';
import { createTelemetry } from './telemetry.ts';
import { measureNative } from './workbench-performance.ts';

export const telemetry = createTelemetry(async (events) => {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('app_telemetry', { events });
});

export async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return observeOperation(
    telemetryOperation(command, args),
    () => measureNative(command, () => invoke<T>(command, args)),
    telemetry.track,
  );
}
