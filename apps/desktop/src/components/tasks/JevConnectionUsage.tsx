import { InlineNotice } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { describeError } from '../../lib/errors';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import type { RunUsage } from '../../lib/run-types';

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
    void invokeNative<JevConnectionTotals>('routing_connection_usage')
      .then((value) => {
        if (current) setTotals(value);
      })
      .catch((error) => {
        if (current) setError(describeError(error));
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
                : 'Token usage unavailable'}
              {totals.unreportedCalls > 0 &&
                ` · ${totals.unreportedCalls.toLocaleString()} missing ${totals.unreportedCalls === 1 ? 'report' : 'reports'}`}
            </p>
          )
        )}
      </dd>
    </dl>
  );
}
