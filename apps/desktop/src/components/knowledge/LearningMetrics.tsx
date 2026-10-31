import { DefinitionList, Disclosure, DisclosureBody, DisclosureSummary } from '@jackalope/ui';
import { useState } from 'react';
import { learningMetricRows, type LearningMetrics as Metrics } from '../../lib/learning';
import { nativeTask } from '../../lib/task-runtime';

/** Local learning counts for this project, loaded when opened. */
export function LearningMetrics({
  projectId,
  projectPath,
}: {
  projectId: string;
  projectPath: string;
}) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState('');
  return (
    <Disclosure
      onToggle={(event) => {
        if (!event.currentTarget.open) return;
        setError('');
        nativeTask<Metrics>('knowledge_learning_metrics', { projectId, projectPath })
          .then(setMetrics)
          .catch((cause) => setError(String(cause)));
      }}
    >
      <DisclosureSummary>Learning activity</DisclosureSummary>
      <DisclosureBody className="task-muted">
        {error && <p role="alert">{error}</p>}
        {!error && metrics === null && <p>Loading…</p>}
        {metrics && (
          <>
            <DefinitionList
              items={learningMetricRows(metrics).map(([label, value]) => ({ label, value }))}
            />
            <p>
              Counts from this computer
              {metrics.since ? ` since ${new Date(metrics.since).toLocaleDateString()}` : ''}. Use
              them to judge whether lessons are learned too eagerly or archived too soon.
            </p>
          </>
        )}
      </DisclosureBody>
    </Disclosure>
  );
}
