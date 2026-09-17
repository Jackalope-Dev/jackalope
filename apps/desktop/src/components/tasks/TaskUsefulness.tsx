import { Disclosure, DisclosureSummary, Input } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

interface Rating {
  useful: boolean;
  reviewMinutes: number | null;
}
export function TaskUsefulness({ runId }: { runId: string }) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setRating(null);
    setMinutes('');
    setError('');
    void nativeTask<Rating | null>('task_usefulness', { id: runId })
      .then((value) => {
        if (current) {
          setRating(value);
          setMinutes(value?.reviewMinutes?.toString() ?? '');
        }
      })
      .catch((cause) => {
        if (current) setError(String(cause));
      });
    return () => {
      current = false;
    };
  }, [runId]);
  const save = async (useful: boolean) => {
    if (busy) return;
    setError('');
    if (minutes && (!/^\d+$/.test(minutes) || Number(minutes) > 10080)) {
      setError('Enter whole minutes between 0 and 10,080, or leave this blank.');
      return;
    }
    setBusy(true);
    try {
      setRating(
        await nativeTask<Rating>('task_usefulness', {
          id: runId,
          useful,
          reviewMinutes: minutes ? Number(minutes) : null,
        }),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Disclosure className="my-4">
      <DisclosureSummary>Track result usefulness</DisclosureSummary>
      <div className="space-y-3 py-3">
        <h3>Was this result useful?</h3>
        <p className="task-muted">
          Saved locally with this task. This does not accept changes or send feedback.
        </p>
        <label className="block">
          Minutes spent reviewing and correcting (optional)
          <Input
            type="number"
            min={0}
            max={10080}
            step={1}
            value={minutes}
            disabled={busy}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            aria-pressed={rating?.useful === true}
            onClick={() => void save(true)}
          >
            Useful result
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            aria-pressed={rating?.useful === false}
            onClick={() => void save(false)}
          >
            Needs more work
          </Button>
        </div>
        {rating && (
          <p role="status" className="task-muted">
            Your rating is saved.
          </p>
        )}
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </div>
    </Disclosure>
  );
}
