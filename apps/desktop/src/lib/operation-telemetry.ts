import { type Metric, type Operation, type OperationOutcome, operations } from './telemetry.ts';

const allowed = new Set<string>(operations);
export function telemetryOperation(
  command: string,
  args?: Record<string, unknown>,
): Operation | null {
  if (command === 'live_session_action') {
    const action = args?.action;
    if (action === 'pause' || action === 'resume' || action === 'retry' || action === 'finish')
      return `live_session_${action}`;
    return null;
  }
  return allowed.has(command) ? (command as Operation) : null;
}

function outcome(operation: Operation, result: unknown): OperationOutcome {
  const value = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  if (operation === 'task_verify') {
    const check = value.result as { success?: boolean } | undefined;
    return check?.success === true ? 'accepted' : 'failed';
  }
  if (operation === 'mcp_probe_server') return value.ok === true ? 'accepted' : 'failed';
  if (operation === 'integration_prepare') return value.status === 'ready' ? 'accepted' : 'blocked';
  if (operation === 'integration_apply') {
    if (value.status !== 'applied') return 'blocked';
    const cleanup = value.cleanupResults;
    return Array.isArray(cleanup) && cleanup.some((entry) => !entry?.removed)
      ? 'partial'
      : 'accepted';
  }
  if (operation === 'task_respond_prompt' && result === false) return 'blocked';
  if (
    (operation === 'task_export_recovery' || operation === 'task_import_recovery') &&
    result === null
  )
    return 'canceled';
  return 'accepted';
}

export async function observeOperation<T>(
  operation: Operation | null,
  run: () => Promise<T>,
  track: (metric: Metric) => void,
): Promise<T> {
  const report = (result: OperationOutcome) => {
    if (!operation) return;
    try {
      track({ name: 'operation_result', operation, outcome: result });
      if (result === 'failed') track({ name: 'app_error', code: 'operation_failed', operation });
    } catch {
      // Reporting must never change the result of a native operation.
    }
  };
  let result: T;
  try {
    result = await run();
  } catch (error) {
    report('failed');
    throw error;
  }
  if (operation) report(outcome(operation, result));
  return result;
}
