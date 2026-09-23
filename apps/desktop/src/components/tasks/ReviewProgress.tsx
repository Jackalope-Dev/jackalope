import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

import { ChangedFiles } from './ChangedFiles';

interface Progress {
  tree: string;
  diff: string;
  files: string[];
  viewedAt: string | null;
  note: string;
}

export function ReviewProgress({ runId }: { runId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async (seenTree?: string) => {
    setBusy(true);
    setError('');
    try {
      setProgress(await nativeTask<Progress>('task_review_progress', { id: runId, seenTree }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 my-4" aria-label="Review progress">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          Changes since my last review
        </Button>
        {progress && (
          <Button variant="outline" disabled={busy} onClick={() => void load(progress.tree)}>
            Mark these changes seen
          </Button>
        )}
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {progress && (
        <>
          <p className="task-muted">{progress.note}</p>
          <Disclosure open>
            <DisclosureSummary>
              {progress.files.length} files changed
              {progress.viewedAt
                ? ` since ${new Date(progress.viewedAt).toLocaleString()}`
                : ' in this result'}
            </DisclosureSummary>
            {progress.diff ? (
              <ChangedFiles files={progress.files} patch={progress.diff} />
            ) : (
              <p>
                {progress.viewedAt
                  ? 'No changes since this review position.'
                  : 'No changes in this result.'}
              </p>
            )}
          </Disclosure>
        </>
      )}
    </section>
  );
}
