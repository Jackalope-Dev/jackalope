import { RefreshIcon } from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import './commit-history.css';

interface GraphLine {
  graph: string;
  commit: {
    hash: string;
    subject: string;
    author: string;
    when: string;
    refs: string[];
  } | null;
}

/** Recent commits across local branches, drawn with Git's own branch graph. */
export function CommitHistory({ projectPath }: { projectPath: string }) {
  const [lines, setLines] = useState<GraphLine[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!projectPath || !isTauriEnvironment()) return;
    setLoading(true);
    setError('');
    try {
      setLines(await nativeTask<GraphLine[]>('project_commit_graph', { projectPath, limit: 40 }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="workspace-section workspace-stack commit-history" aria-label="History">
      <WorkspaceSectionHeading
        title="History"
        description="Recent commits on local branches."
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            loading={loading}
            loadingLabel="Refreshing…"
          >
            <RefreshIcon size={16} />
            Refresh
          </Button>
        }
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {lines && !lines.length && !error && <p className="task-muted">No commits yet.</p>}
      {!!lines?.length && (
        <ol className="commit-graph">
          {lines.map((line, index) => (
            <li
              // Graph lines have no identity of their own; the order is Git's output.
              // biome-ignore lint/suspicious/noArrayIndexKey: graph rows are positional
              key={index}
              data-connector={!line.commit || undefined}
            >
              <span className="commit-graph-lanes" aria-hidden="true">
                {line.graph}
              </span>
              {line.commit && (
                <span className="commit-graph-commit">
                  <code>{line.commit.hash}</code>
                  <span className="commit-graph-subject" title={line.commit.subject}>
                    {line.commit.subject}
                  </span>
                  {line.commit.refs.map((ref) => (
                    <span key={ref} className="commit-graph-ref">
                      {ref}
                    </span>
                  ))}
                  <small>
                    {line.commit.author} · {line.commit.when}
                  </small>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
