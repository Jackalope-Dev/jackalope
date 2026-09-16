import { useEffect, useState } from 'react';
import { nativeTask, type RunUsage } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';

export interface JevConnectionTotals {
  calls: number;
  unreportedCalls: number;
  usage: RunUsage;
}

export function JevConnectionUsage() {
  const [totals, setTotals] = useState<JevConnectionTotals | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let current = true;
    void nativeTask<JevConnectionTotals>('routing_connection_usage')
      .then((value) => {
        if (current) setTotals(value);
      })
      .catch((error) => {
        if (current) setError(String(error));
      });
    return () => {
      current = false;
    };
  }, []);
  if (!error && !totals?.calls) return null;
  return (
    <section className="workspace-section workspace-stack">
      <WorkspaceSectionHeading
        title="Jev connection checks"
        description="Device totals across all time. Setup checks are separate from project, period and task totals above."
      />
      {error ? (
        <InlineNotice tone="error">{error}</InlineNotice>
      ) : (
        totals && (
          <>
            <p className="task-muted text-sm">
              {totals.calls.toLocaleString()} checks ·{' '}
              {totals.usage.reported
                ? `${totals.usage.input.toLocaleString()} input + ${totals.usage.output.toLocaleString()} output tokens reported`
                : 'Token usage unavailable'}{' '}
              ·{' '}
              {totals.usage.estimatedCostUsd == null
                ? 'Cost unavailable'
                : `$${totals.usage.estimatedCostUsd.toFixed(6)} estimated`}
            </p>
            {totals.unreportedCalls > 0 && (
              <p className="task-muted text-xs">
                {totals.unreportedCalls} checks have no usage report and are excluded from known
                token and cost totals.
              </p>
            )}
            <p className="task-muted text-xs">
              Jev task-routing calls, including reported usage from uncertain decisions, are
              included in the routing entries above. Estimates use $0.042 per million input tokens
              and free output; TypeSafe billing remains authoritative.
            </p>
          </>
        )
      )}
    </section>
  );
}
