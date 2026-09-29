import { FolderX, GitBranch } from 'lucide-react';
import { LoadingState } from '../ui/LoadingState';

/**
 * What a confirm is about to remove, and which step it is on once it runs:
 * removing several worktrees is slow enough to look stalled without it.
 */
export function WorktreeRemovalPlan({
  names = [],
  paths = [],
  progress,
  busy = false,
  busyNote,
  isFolder = false,
}: {
  names?: string[];
  paths?: string[];
  progress?: string;
  busy?: boolean;
  busyNote?: string;
  isFolder?: boolean;
}) {
  if (busy) {
    return (
      <div className="cleanup-plan-busy" role="status" aria-live="polite">
        <LoadingState label={progress || 'Cleaning up…'} compact />
        <p className="task-muted text-xs">
          {busyNote || 'Removing files and Git branches. This may take a moment…'}
        </p>
      </div>
    );
  }

  if (names.length < 2 && !paths.length) return null;

  const Icon = isFolder ? FolderX : GitBranch;

  return (
    <div className="cleanup-plan">
      {names.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <p className="cleanup-plan-heading">
            {isFolder ? 'Folders' : 'Worktrees'} to remove ({names.length}):
          </p>
          <ul className="cleanup-plan-list">
            {names.map((name) => (
              <li key={name} className="cleanup-plan-item font-mono text-xs">
                <Icon
                  size={14}
                  className="shrink-0 text-[var(--color-text-muted)]"
                  aria-hidden="true"
                />
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {paths.length > 0 && (
        <details className="cleanup-plan-note">
          <summary>Ignored files deleted too ({paths.length})</summary>
          <p className="font-mono text-xs break-all">{paths.join(', ')}</p>
        </details>
      )}
    </div>
  );
}
