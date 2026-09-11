import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
export function TaskFailure({ message, onInspect }: { message: string; onInspect: () => void }) {
  const firstLine = message.trim().split('\n')[0];
  const summary = firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
  return (
    <InlineNotice
      tone="error"
      className="task-failure"
      action={
        <Button variant="ghost" onClick={onInspect}>
          Inspect activity
        </Button>
      }
    >
      <p>{summary || 'The task ended with an error.'}</p>
      {message.trim() !== summary && (
        <Disclosure>
          <DisclosureSummary>Error details</DisclosureSummary>
          <pre className="task-output">{message}</pre>
        </Disclosure>
      )}
    </InlineNotice>
  );
}
