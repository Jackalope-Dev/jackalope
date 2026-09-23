import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { pendingWorkFeedback, type WorkFeedback } from '../../lib/work-feedback';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

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
  useEffect(() => {
    const refresh = () => {
      try {
        setItems(pendingWorkFeedback(taskId));
      } catch (cause) {
        setError(`Saved feedback could not be read: ${String(cause)}`);
      }
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('jackalope:work-feedback', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('jackalope:work-feedback', refresh);
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
                  setError(String(cause));
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
                  setError(String(cause));
                }
              }}
            >
              Dismiss feedback
            </Button>
          </div>
        ))}
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </div>
    </Disclosure>
  );
}
