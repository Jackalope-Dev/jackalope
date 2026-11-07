import { observeOperation, telemetryOperation } from '../operation-telemetry.ts';
import { telemetry } from '../telemetry-client.ts';
import { measureNative } from '../workbench-performance.ts';
import { isTauriEnvironment } from './env.ts';

const barriers = new Map<string, () => Promise<void>>();

/**
 * Makes every later call to one of `commands` wait for `ready` first, and fail
 * with its error. Webview-owned state that the native side reads registers here.
 */
export function awaitBeforeNative(commands: Iterable<string>, ready: () => Promise<void>) {
  for (const command of commands) barriers.set(command, ready);
}

/** Calls a Tauri command, reporting its outcome and timing. Rejects in the browser preview. */
export async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment())
    throw new Error(
      'Open the desktop app to connect projects and run agents. This browser preview does not execute work.',
    );
  await barriers.get(command)?.();
  const { invoke } = await import('@tauri-apps/api/core');
  return observeOperation(
    telemetryOperation(command, args),
    () => measureNative(command, () => invoke<T>(command, args)),
    telemetry.track,
  );
}
