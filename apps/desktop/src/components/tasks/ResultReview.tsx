import { FileDiff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { nativeTask, type Review, type TaskRun } from '../../lib/task-runtime';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { CrossModelReviewPanel } from './CrossModelReviewPanel';
import { PatchPreview } from './PatchPreview';
import { ProjectVerification } from './ProjectVerification';
import { TaskImpact } from './TaskImpact';

export function ResultReview({ run }: { run: TaskRun }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
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
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-medium">
          <FileDiff size={16} />
          Workspace changes
        </h3>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? 'Reading…' : review ? 'Refresh changes' : 'Inspect changes'}
        </Button>
      </div>
      {error && (
        <InlineNotice tone="error" className="mt-3">
          {error}
        </InlineNotice>
      )}
      <ProjectVerification run={run} command={project?.preferences?.verifyCommand} />
      {loading && (
        <p role="status" className="task-muted">
          Reading changes from this task’s workspace…
        </p>
      )}
      {review && (
        <div className="mt-4">
          <p className="task-muted text-xs mb-4">{review.note}</p>
          {review.files.length ? (
            <ul className="task-files">
              {review.files.map((file) => (
                <li key={file}>
                  <FileDiff size={13} />
                  <span>{file}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="task-muted">No changed files found.</p>
          )}
          <section aria-label="Affected code">
            <TaskImpact
              key={`${run.id}:${JSON.stringify(review.files)}`}
              run={run}
              files={review.files}
            />
          </section>
          {review.diff && (
            <CrossModelReviewPanel run={run} files={review.files} diff={review.diff} />
          )}
          {review.diff && <PatchPreview key={review.diff} patch={review.diff} />}
        </div>
      )}
    </div>
  );
}
