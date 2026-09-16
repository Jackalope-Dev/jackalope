import { Disclosure, DisclosureBody, DisclosureSummary, Table } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import {
  countedTaskDecisions,
  readTaskDecisionUsage,
  type TaskDecisionUsage,
} from '../../lib/decision-usage';
import { summarizeUsage } from '../../lib/usage-insights';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';

export { countedTaskDecisions, readTaskDecisionUsage } from '../../lib/decision-usage';

export function useTaskDecisionUsage(enabled = true) {
  const [records, setRecords] = useState<TaskDecisionUsage[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const read = () =>
      void readTaskDecisionUsage()
        .then((values) => {
          if (alive) {
            setRecords(values);
            setLoading(false);
            setError('');
          }
        })
        .catch((cause) => {
          if (alive) {
            setError(String(cause));
            setLoading(false);
          }
        });
    read();
    const timer = setInterval(read, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);
  return { records, error, loading };
}

export function DecisionUsage({
  records,
  error,
  loading,
  projectId,
  cutoff = 0,
}: ReturnType<typeof useTaskDecisionUsage> & { projectId?: string; cutoff?: number }) {
  const entries = countedTaskDecisions(records, projectId, cutoff);
  const summary = summarizeUsage(entries.map((entry) => ({ usage: entry.decision.usage })));
  return (
    <section aria-label="Task assessment usage" className="workspace-section workspace-stack">
      <WorkspaceSectionHeading
        title="Task assessments"
        description="Decision calls for the selected project and period, separate from task execution."
      />
      {error ? (
        <InlineNotice tone="error">{error}</InlineNotice>
      ) : loading ? (
        <p role="status">Loading assessment usage…</p>
      ) : !entries.length ? (
        <p className="task-muted">
          No model assessments recorded in this view. Local decisions use no model tokens.
        </p>
      ) : (
        <>
          <p>
            {entries.length} {entries.length === 1 ? 'assessment' : 'assessments'} ·{' '}
            {summary.tokens === null
              ? 'Tokens unavailable'
              : `${summary.tokens.toLocaleString()} reported tokens`}
            {summary.missing ? ` · ${summary.missing} usage reports unavailable` : ''}
            {summary.costUsd === null
              ? ' · Cost unavailable'
              : ` · $${summary.costUsd.toFixed(6)} estimated`}
            {summary.costMissing || summary.missing ? ' · Cost coverage is incomplete' : ''}
          </p>
          <Disclosure>
            <DisclosureSummary>Assessment details</DisclosureSummary>
            <DisclosureBody>
              <Table label="Task assessment usage">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Decision</th>
                    <th scope="col">Tokens</th>
                    <th scope="col">Estimated cost</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      <td>
                        {entry.decision.requestedMode === 'jev' ? 'Jev' : 'Agent'}
                        {entry.decision.provider === 'local_rules' ? ' → local fallback' : ''}
                      </td>
                      <td>Task strategy</td>
                      <td>
                        {entry.decision.usage.reported
                          ? (
                              entry.decision.usage.input + entry.decision.usage.output
                            ).toLocaleString()
                          : 'Unavailable'}
                      </td>
                      <td>
                        {entry.decision.usage.estimatedCostUsd == null
                          ? 'Unavailable'
                          : new Intl.NumberFormat(undefined, {
                              style: 'currency',
                              currency: 'USD',
                              maximumFractionDigits: 6,
                            }).format(entry.decision.usage.estimatedCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </DisclosureBody>
          </Disclosure>
          <p className="task-muted">
            Includes assessments that did not launch work. Reused assessments appear once. These
            calls are separate from worker routing and execution totals.
          </p>
        </>
      )}
    </section>
  );
}
