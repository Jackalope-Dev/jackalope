import { useEffect, useState } from 'react';
import { nativeTask, type RunUsage } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { InlineNotice } from '../ui/InlineNotice';

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
    <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1" aria-label="Jev setup usage">
      <dt>
        <strong className="text-sm">Jev setup</strong>
        <span className="task-muted text-xs ml-3">This device · all time</span>
      </dt>
      <dd>
        {error ? (
          <InlineNotice tone="error">Jev setup usage unavailable. {error}</InlineNotice>
        ) : (
          totals && (
            <p className="task-muted text-sm">
              {totals.calls.toLocaleString()} calls ·{' '}
              {totals.usage.reported
                ? `${totals.usage.input.toLocaleString()} input + ${totals.usage.output.toLocaleString()} output tokens reported`
                : 'Token usage unavailable'}{' '}
              ·{' '}
              {totals.usage.estimatedCostUsd == null
                ? 'Cost unavailable'
                : `$${totals.usage.estimatedCostUsd.toFixed(6)} estimated`}
              {totals.unreportedCalls > 0 &&
                ` · ${totals.unreportedCalls.toLocaleString()} missing ${totals.unreportedCalls === 1 ? 'report' : 'reports'}`}
            </p>
          )
        )}
      </dd>
    </dl>
  );
}
