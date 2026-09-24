import { downloadPercent, formatSize, type LocalProgress } from '../../lib/local-ai';
import { Button } from '../ui/button';
import './managed-runtime-progress.css';

export function ManagedRuntimeProgress({
  progress,
  onCancel,
}: {
  progress: LocalProgress | null;
  onCancel: () => void;
}) {
  const percent = downloadPercent(progress);
  return (
    <div className="grid gap-2">
      <p role="status" className="task-muted text-sm">
        {progress?.message ?? 'Preparing the private runner…'}
        {progress?.total
          ? ` · ${formatSize(progress.completed)} of ${formatSize(progress.total)}`
          : ''}
      </p>
      {percent !== undefined && (
        <progress
          aria-label="Runner download"
          max={100}
          value={percent}
          className="managed-runtime-progress"
        />
      )}
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel runner setup
      </Button>
    </div>
  );
}
