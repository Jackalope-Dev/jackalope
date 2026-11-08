import { Disclosure, DisclosureBody, DisclosureSummary, InlineNotice, Table } from '@jackalope/ui';
import {
  countedTaskDecisions,
  decisionUsageEntries,
  readTaskDecisionUsage,
  type TaskDecisionUsage,
} from '../../lib/decision-usage';
import { decisionLabels } from '../../lib/decisions';
import { summarizeUsage } from '../../lib/usage-insights';
import { useNativeResource } from '../../hooks/useNativeResource';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';

const NO_RECORDS: TaskDecisionUsage[] = [];

export function useTaskDecisionUsage() {
  const { data, error, loading } = useNativeResource(readTaskDecisionUsage, [], { pollMs: 15000 });
  return { records: data ?? NO_RECORDS, error, loading };
}

export function DecisionUsage({
  records,
  error,
  loading,
  projectId,
  cutoff = 0,
}: ReturnType<typeof useTaskDecisionUsage> & { projectId?: string; cutoff?: number }) {
  const entries = countedTaskDecisions(records, projectId, cutoff);
  const calls = entries.flatMap((entry) =>
    decisionUsageEntries(entry.decision).map((attempt, index) => ({
      ...entry,
      attempt,
      key: `${entry.id}-${index}`,
    })),
  );
  const summary = summarizeUsage(calls.map((entry) => entry.attempt));
  return (
    <section aria-label="Task assessment usage" className="workspace-section workspace-stack">
      <WorkspaceSectionHeading title="Task assessments" />
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
            {entries.length} {entries.length === 1 ? 'assessment' : 'assessments'} · {calls.length}{' '}
            {calls.length === 1 ? 'model call' : 'model calls'} ·{' '}
            {summary.tokens === null
              ? 'Tokens unavailable'
              : `${summary.tokens.toLocaleString()} reported tokens`}
            {summary.missing ? ` · ${summary.missing} usage reports unavailable` : ''}
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
                  </tr>
                </thead>
                <tbody>
                  {calls.map((entry) => (
                    <tr key={entry.key}>
                      <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      <td>
                        {entry.attempt.provider === 'jev' ? 'Jev' : 'Agent'}
                        {entry.attempt.provider === 'agent' &&
                        entry.decision.requestedMode === 'jev'
                          ? ' (fallback)'
                          : ''}
                        {entry.decision.provider === 'local_rules' ? ' → local fallback' : ''}
                      </td>
                      <td>{decisionLabels[entry.decision.kind]}</td>
                      <td>
                        {entry.attempt.usage.reported
                          ? (
                              entry.attempt.usage.input + entry.attempt.usage.output
                            ).toLocaleString()
                          : 'Unavailable'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </DisclosureBody>
          </Disclosure>
          <p className="task-muted">
            Includes assessments that did not launch work. Reused assessments appear once.
          </p>
        </>
      )}
    </section>
  );
}
