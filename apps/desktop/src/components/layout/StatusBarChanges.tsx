import { GitCommitHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppEvent } from '../../lib/app-events';
import { isTauriEnvironment } from '../../lib/native/env';
import { workingChanges } from '../../lib/project-git';
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
  // The Changes page announces commits and discards so this updates at once.
  const reread = useRef<() => void>(undefined);
  useAppEvent('changes-updated', () => reread.current?.());
  useEffect(() => {
    if (!isTauriEnvironment() || !projectPath || !checkout) return;
    let live = true;
    let reading = false;
    const read = () => {
      // A read can outlast the interval on a busy disk; overlapping ones would
      // stack Git processes that each walk the whole checkout.
      if (document.hidden || reading) return;
      reading = true;
      workingChanges({ repoPath: projectPath, worktreePath: checkout })
        .then((changes) => live && setCount(changes.files.length))
        // A worktree still being prepared, or removed, simply shows nothing.
        .catch(() => live && setCount(null))
        .finally(() => {
          reading = false;
        });
    };
    read();
    reread.current = read;
    const timer = setInterval(read, 15_000);
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', read);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', read);
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
