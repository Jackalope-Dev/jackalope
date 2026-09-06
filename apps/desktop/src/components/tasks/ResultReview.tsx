import { FileDiff } from 'lucide-react';
import { useState } from 'react';
import { nativeTask, type Review, type TaskRun } from '../../lib/task-runtime';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { PatchPreview } from './PatchPreview';
import { ProjectVerification } from './ProjectVerification';
import { TaskImpact } from './TaskImpact';

export function ResultReview({ run }: { run: TaskRun }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { projects } = useProjectStore();
  const project = projects.find((p) => p.id === run.projectId);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setReview(await nativeTask<Review>('task_review', { id: run.id }));
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  };
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
        <p role="alert" className="task-error mt-3">
          {error}
        </p>
      )}
      <ProjectVerification run={run} command={project?.preferences?.verifyCommand} />
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
          <TaskImpact
            key={`${run.id}:${JSON.stringify(review.files)}`}
            run={run}
            files={review.files}
          />
          {review.diff && <PatchPreview key={review.diff} patch={review.diff} />}
        </div>
      )}
    </div>
  );
}
