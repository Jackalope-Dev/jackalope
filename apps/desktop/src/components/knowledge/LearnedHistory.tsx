import { Disclosure, DisclosureBody, DisclosureSummary } from '@jackalope/ui';
import { useState } from 'react';
import { type LedgerRecord, ledgerActionLabel } from '../../lib/learning';
import { nativeTask } from '../../lib/task-runtime';

/** Why a learned lesson exists and how it changed, loaded when opened. */
export function LearnedHistory({ projectId, entryId }: { projectId: string; entryId: string }) {
  const [records, setRecords] = useState<LedgerRecord[] | null>(null);
  const [error, setError] = useState('');
  return (
    <Disclosure
      onToggle={(event) => {
        if (!event.currentTarget.open) return;
        setError('');
        nativeTask<LedgerRecord[]>('knowledge_history', { projectId, entryId })
          .then(setRecords)
          .catch((cause) => setError(String(cause)));
      }}
    >
      <DisclosureSummary>History</DisclosureSummary>
      <DisclosureBody className="task-muted break-words">
        {error && <p role="alert">{error}</p>}
        {!error && records === null && <p>Loading…</p>}
        {records?.length === 0 && <p>No recorded changes.</p>}
        {records && records.length > 0 && (
          <ol className="learned-history">
            {[...records].reverse().map((record) => (
              <li key={record.id}>
                <p>
                  <strong>{ledgerActionLabel(record.action)}</strong> ·{' '}
                  {new Date(record.at).toLocaleDateString()} · {record.reason}
                </p>
                {record.evidence?.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </li>
            ))}
          </ol>
        )}
      </DisclosureBody>
    </Disclosure>
  );
}
