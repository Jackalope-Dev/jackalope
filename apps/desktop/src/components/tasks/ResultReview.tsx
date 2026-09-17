import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { FileDiff, RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { nativeTask, type Review, type TaskRun } from '../../lib/task-runtime';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { ChangedFiles } from './ChangedFiles';
import { CrossModelReviewPanel } from './CrossModelReviewPanel';
import { ProjectVerification } from './ProjectVerification';
import { ReviewProgress } from './ReviewProgress';
import { TaskImpact } from './TaskImpact';
import { TaskUsefulness } from './TaskUsefulness';
import './result-review.css';

export function ResultReview({
  run,
  onCorrect,
  outcomes,
  evidence,
  visible = true,
  review: suppliedReview,
  onRefresh,
}: {
  run: TaskRun;
  onCorrect?: (prompt: string) => void;
  outcomes?: ReactNode;
  evidence?: ReactNode;
  visible?: boolean;
  review?: Review;
  onRefresh?: () => void | Promise<void>;
}) {
  const [loadedReview, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const review = suppliedReview ?? loadedReview;
  const { projects } = useProjectStore();
  const project = projects.find((p) => p.id === run.projectId);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (suppliedReview) await onRefresh?.();
      else setReview(await nativeTask<Review>('task_review', { id: run.id }));
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }, [run.id, suppliedReview, onRefresh]);
  useEffect(() => {
    if (visible && !suppliedReview) void load();
  }, [load, visible, suppliedReview]);
  return (
    <div className="task-review">
      <div className="task-review-toolbar">
        <h3 className="flex items-center gap-2 font-medium">
          <FileDiff size={16} />
          Changes{' '}
          {review ? `· ${review.files.length} ${review.files.length === 1 ? 'file' : 'files'}` : ''}
        </h3>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
          loading={loading}
          loadingLabel="Reading…"
        >
          <RefreshCw size={14} /> Refresh changes
        </Button>
      </div>
      {error && (
        <InlineNotice tone="error" className="mt-3">
          {error}
        </InlineNotice>
      )}
      {loading && (
        <p role="status" className="task-muted">
          Reading changes from this task’s workspace…
        </p>
      )}
      <div className="task-review-layout">
        <section className="task-review-output" aria-label="Changed files">
          {review && (
            <>
              <ChangedFiles files={review.files} patch={review.diff} visible={visible} />
              {review.note && (
                <Disclosure>
                  <DisclosureSummary>About these changes</DisclosureSummary>
                  <p className="task-muted">{review.note}</p>
                </Disclosure>
              )}
            </>
          )}
        </section>
        <aside className="task-review-checklist" aria-label="Review checks">
          <ProjectVerification
            run={run}
            command={project?.preferences?.verifyCommand}
            onCorrect={onCorrect}
          />
          {outcomes}
          {evidence}
          {review && (
            <Disclosure className="task-review-tools">
              <DisclosureSummary>More review tools</DisclosureSummary>
              <ReviewProgress key={`progress:${run.id}`} runId={run.id} />
              <TaskImpact
                key={`${run.id}:${JSON.stringify(review.files)}`}
                run={run}
                files={review.files}
              />
              {review.diff && (
                <CrossModelReviewPanel run={run} files={review.files} diff={review.diff} />
              )}
              <TaskUsefulness key={`usefulness:${run.id}`} runId={run.id} />
            </Disclosure>
          )}
        </aside>
      </div>
    </div>
  );
}
