import { GitCommitHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { openChanges } from '../../stores/commitReviewStore';

/**
 * "N changes" for the checkout in view, linking to the Changes page. Hidden
 * when there is nothing to commit or the checkout cannot be read.
 */
export function StatusBarChanges({
  projectPath,
  checkout,
}: {
  projectPath: string;
  checkout: string;
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!isTauriEnvironment() || !projectPath || !checkout) return;
    let live = true;
    const read = () => {
      if (document.hidden) return;
      nativeTask<{ files: unknown[] }>('git_working_changes', {
        repoPath: projectPath,
        worktreePath: checkout,
      })
        .then((changes) => live && setCount(changes.files.length))
        // A worktree still being prepared, or removed, simply shows nothing.
        .catch(() => live && setCount(null));
    };
    read();
    const timer = setInterval(read, 15_000);
    window.addEventListener('focus', read);
    // The Changes page announces commits and discards so this updates at once.
    window.addEventListener('jackalope:changes-updated', read);
    document.addEventListener('visibilitychange', read);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', read);
      window.removeEventListener('jackalope:changes-updated', read);
      document.removeEventListener('visibilitychange', read);
    };
  }, [projectPath, checkout]);
  if (!count) return null;
  return (
    <button
      type="button"
      className="statusbar-changes"
      onClick={() => openChanges(checkout)}
      title="Review and commit these changes"
    >
      <GitCommitHorizontal size={15} aria-hidden="true" />
      {count} {count === 1 ? 'change' : 'changes'}
    </button>
  );
}
