import type { TaskRun } from './task-runtime';
import { agents, type Metric, type TaskState, type TelemetryAgent } from './telemetry.ts';

interface Snapshot {
  status: TaskRun['status'];
  persistenceError: boolean;
  checkpointError: boolean;
  verificationError: boolean;
  verificationAt?: string;
}
export function createTaskTelemetry(track: (metric: Metric) => void, startedAt = Date.now()) {
  const seen = new Map<string, Snapshot>();
  return (runs: TaskRun[], enabled: boolean) => {
    for (const run of runs) {
      const old = seen.get(run.id);
      const recent = Date.parse(run.startedAt) >= startedAt;
      seen.set(run.id, {
        status: run.status,
        persistenceError: !!run.persistenceError,
        checkpointError: !!run.checkpointError,
        verificationError: !!run.verificationError,
        verificationAt: run.verification?.checkedAt,
      });
      if (!enabled || (!old && !recent)) continue;
      const agent: TelemetryAgent = agents.includes(run.agent as TelemetryAgent)
        ? (run.agent as TelemetryAgent)
        : 'other';
      const workflow = run.liveSessionId ? 'chat' : 'task';
      if (!old) track({ name: 'task_state', state: 'starting', agent, workflow });
      if (old?.status !== run.status && run.status !== 'starting' && run.status !== 'stopping')
        track({ name: 'task_state', state: run.status as TaskState, agent, workflow });
      if (old?.status !== run.status && run.status === 'failed')
        track({ name: 'app_error', code: 'task_failed' });
      if (run.persistenceError && !old?.persistenceError)
        track({ name: 'app_error', code: 'history_save_failed' });
      if (run.checkpointError && !old?.checkpointError)
        track({ name: 'app_error', code: 'checkpoint_failed' });
      if (run.verificationError && !old?.verificationError)
        track({ name: 'app_error', code: 'verification_error' });
      if (
        run.verification?.result.success === false &&
        run.verification.checkedAt !== old?.verificationAt
      )
        track({ name: 'app_error', code: 'verification_failed' });
    }
  };
}
