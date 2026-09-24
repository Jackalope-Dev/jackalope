import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import type { TaskRun } from '../../lib/task-runtime';

const phases: Record<string, string> = {
  workspace: 'Workspace preparation',
  preparationWait: 'Waiting for setup capacity',
  preparation: 'Setup commands',
  routing: 'Agent selection',
  capacity: 'Account capacity',
  repositoryMap: 'Repository context',
  processSpawn: 'Process launch',
  verificationWait: 'Waiting for check capacity',
  verification: 'Check commands',
};

export function TaskTiming({ run }: { run: TaskRun }) {
  const metrics = run.efficiency;
  const timings = Object.entries(metrics?.timings ?? {}).filter(([, timing]) => timing.calls > 0);
  if (!metrics || !timings.length) return null;
  return (
    <Disclosure className="my-3">
      <DisclosureSummary>Execution timing</DisclosureSummary>
      <dl className="workspace-stack mt-3">
        {timings.map(([phase, timing]) => (
          <div key={phase}>
            <dt>{phases[phase] ?? phase}</dt>
            <dd>{(timing.totalMs / 1000).toFixed(2)} seconds</dd>
          </div>
        ))}
        {metrics.firstActivityMs != null && (
          <div>
            <dt>First agent activity after launch</dt>
            <dd>{(metrics.firstActivityMs / 1000).toFixed(2)} seconds</dd>
          </div>
        )}
        {!!metrics.verificationReuses && (
          <div>
            <dt>Unchanged checks reused</dt>
            <dd>{metrics.verificationReuses}</dd>
          </div>
        )}
        {!!metrics.preparationReuses && (
          <div>
            <dt>Completed setup reused</dt>
            <dd>{metrics.preparationReuses}</dd>
          </div>
        )}
      </dl>
      <p className="task-muted mt-3">
        Some stages overlap. Missing measurements are unavailable. These timings exclude human
        review and corrections.
      </p>
    </Disclosure>
  );
}
