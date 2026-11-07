import { observeOperation, telemetryOperation } from '../operation-telemetry.ts';
import { telemetry } from '../telemetry-client.ts';
import { measureNative } from '../workbench-performance.ts';
import { isTauriEnvironment } from './env.ts';

/** Calls a Tauri command, reporting its outcome and timing. Rejects in the browser preview. */
export async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment())
    throw new Error(
      'Open the desktop app to connect projects and run agents. This browser preview does not execute work.',
    );
  const { invoke } = await import('@tauri-apps/api/core');
  return observeOperation(
    telemetryOperation(command, args),
    () => measureNative(command, () => invoke<T>(command, args)),
    telemetry.track,
  );
}
