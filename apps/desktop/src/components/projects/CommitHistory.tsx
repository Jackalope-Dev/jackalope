import { useCallback, useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
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
export function CommitHistory({ projectPath, version }: { projectPath: string; version: number }) {
  const [lines, setLines] = useState<GraphLine[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!projectPath || !isTauriEnvironment()) return;
    setError('');
    try {
      setLines(await nativeTask<GraphLine[]>('project_commit_graph', { projectPath, limit: 40 }));
    } catch (cause) {
      setError(String(cause));
    }
  }, [projectPath]);
  // The page's Refresh and each change refresh bump `version`, so history follows new commits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is a reload signal
  useEffect(() => {
    void load();
  }, [load, version]);
  return (
    <section className="workspace-section workspace-stack commit-history" aria-label="History">
      <WorkspaceSectionHeading title="History" />
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
