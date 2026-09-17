import { Disclosure, DisclosureBody, DisclosureSummary } from '@jackalope/ui';
import type { TaskRun } from '../../lib/task-runtime';

export function DecisionAdvice({ run }: { run: TaskRun }) {
  const advice = run.activity.filter((line) => line.startsWith('Jev advisory '));
  if (!advice.length) return null;
  return (
    <Disclosure>
      <DisclosureSummary>Jev review assistance</DisclosureSummary>
      <DisclosureBody>
        <p className="task-muted">
          Advice from this attempt’s recorded result and bounded diff. Later edits can make it
          stale. These assessments do not approve work or replace verification.
        </p>
        {advice.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </DisclosureBody>
    </Disclosure>
  );
}
