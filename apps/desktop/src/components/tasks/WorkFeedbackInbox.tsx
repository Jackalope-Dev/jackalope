import { Button, Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import { useAppEvent } from '../../lib/app-events';
import { describeError } from '@jackalope/contracts/errors';
import { pendingWorkFeedback, type WorkFeedback } from '../../lib/work-feedback';
import { ActionError } from '../ui/ActionError';

export function WorkFeedbackInbox({
  taskId,
  onFeedback,
}: {
  taskId: string;
  onFeedback: (text: string) => void | Promise<void>;
}) {
  const [items, setItems] = useState<WorkFeedback[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reread = useRef<() => void>(undefined);
  useAppEvent('work-feedback', () => reread.current?.());
  useEffect(() => {
    const refresh = () => {
      try {
        setItems(pendingWorkFeedback(taskId));
      } catch (cause) {
        setError(`Saved feedback could not be read: ${describeError(cause)}`);
      }
    };
    refresh();
    reread.current = refresh;
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
    };
  }, [taskId]);
  if (!items.length && !error) return null;
  return (
    <Disclosure className="work-context">
      <DisclosureSummary>
        {items.length
          ? `${items.length} saved feedback ${items.length === 1 ? 'item' : 'items'}`
          : 'Saved feedback needs attention'}
      </DisclosureSummary>
      <div className="work-context-body">
        {items.map((item) => (
          <div key={item.key}>
            <p className="topic-source">{item.text}</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await onFeedback(`Feedback from attempt ${item.runId}:\n${item.text}`);
                  localStorage.removeItem(item.key);
                  setItems(pendingWorkFeedback(taskId));
                } catch (cause) {
                  setError(describeError(cause));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add to reply draft
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                try {
                  localStorage.removeItem(item.key);
                  setItems(pendingWorkFeedback(taskId));
                } catch (cause) {
                  setError(describeError(cause));
                }
              }}
            >
              Dismiss feedback
            </Button>
          </div>
        ))}
        <ActionError error={error} />
      </div>
    </Disclosure>
  );
}
