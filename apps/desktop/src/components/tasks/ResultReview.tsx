import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { FileDiff, RefreshCw } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { nativeTask, type Review, type TaskRun } from '../../lib/task-runtime';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { CrossModelReviewPanel } from './CrossModelReviewPanel';
import { DiffPreview } from './DiffPreview';
import { ProjectVerification } from './ProjectVerification';
import { ReviewProgress } from './ReviewProgress';
import { TaskImpact } from './TaskImpact';
import { TaskUsefulness } from './TaskUsefulness';

export function ResultReview({
  run,
  onCorrect,
  outcomes,
  evidence,
  visible = true,
}: {
  run: TaskRun;
  onCorrect?: (prompt: string) => void;
  outcomes?: ReactNode;
  evidence?: ReactNode;
  visible?: boolean;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState('');
  const { projects } = useProjectStore();
  const project = projects.find((p) => p.id === run.projectId);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReview(await nativeTask<Review>('task_review', { id: run.id }));
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }, [run.id]);
  useEffect(() => {
    void load();
  }, [load]);
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
              {review.files.length > 1 && (
                <div className="task-review-file">
                  <Select
                    aria-label="Changed file"
                    value={file ? `file:${file}` : 'all'}
                    onValueChange={(value) => setFile(value === 'all' ? '' : value.slice(5))}
                  >
                    <SelectItem value="all">All changed files ({review.files.length})</SelectItem>
                    {review.files.map((path) => (
                      <SelectItem key={path} value={`file:${path}`}>
                        {path}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
              )}
              {review.diff ? (
                visible && (
                  <DiffPreview key={review.diff} patch={review.diff} file={file || undefined} />
                )
              ) : (
                <p className="task-muted">No text changes to review.</p>
              )}
              {!review.diff && review.files.length > 0 && (
                <ul className="task-files">
                  {review.files.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              )}
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
