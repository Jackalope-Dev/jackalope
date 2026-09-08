import { useEffect, useState } from 'react';
import { openKnowledgeTask, useKnowledge } from '../../lib/knowledge';
import { nextAction, returnToProject } from '../../lib/project-return';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import type { Project } from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import type { Readiness } from './WorkspaceReadiness';

export function ProjectReturn({
  project,
  runs,
  integratedIds,
  onOpen,
}: {
  project: Project;
  runs: TaskRun[];
  integratedIds: string[];
  onOpen: (id: string) => void;
}) {
  const unfinished = returnToProject(runs, project.id, integratedIds);
  const { entries, error: knowledgeError } = useKnowledge(project.id, project.path);
  const [snapshot, setSnapshot] = useState<Readiness | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    if (isTauriEnvironment())
      void nativeTask<Readiness>('project_readiness', { path: project.path })
        .then((value) => {
          if (alive) setSnapshot(value);
        })
        .catch((cause) => {
          if (alive) setError(String(cause));
        });
    return () => {
      alive = false;
    };
  }, [project.path]);
  if (!unfinished.length && !entries.length) return null;
  return (
    <details className="project-return my-5">
      <summary className="min-h-11 py-3 font-medium">
        Pick up in {project.name} · {unfinished.length} unfinished
      </summary>
      <div className="space-y-3">
        {unfinished.slice(0, 3).map((run) => (
          <div key={run.id} className="flex flex-wrap justify-between gap-3 items-center">
            <div className="min-w-0">
              <p className="font-medium break-words">{taskTitle(run.prompt)}</p>
              <p className="task-muted">{nextAction(run)}</p>
            </div>
            <Button variant="outline" onClick={() => onOpen(run.id)}>
              Open task
            </Button>
          </div>
        ))}
        {unfinished.length > 3 && (
          <p className="task-muted">
            {unfinished.length - 3} more unfinished tasks are in the collection below.
          </p>
        )}
        {!!entries.filter((e) => e.enabled && e.kind === 'memory').length && (
          <details>
            <summary className="min-h-11 py-3">Project decisions</summary>
            {entries
              .filter((e) => e.enabled && e.kind === 'memory')
              .slice(0, 5)
              .map((entry) => (
                <div key={entry.id} className="py-2">
                  <p className="font-medium">{entry.title}</p>
                  <p className="whitespace-pre-wrap break-words">{entry.content}</p>
                  <p className="task-muted">
                    Saved {new Date(entry.updatedAt).toLocaleDateString()}
                    {entry.sourceHead && snapshot && snapshot.head !== entry.sourceHead
                      ? ' · Project revision changed; check whether this still applies.'
                      : ''}
                  </p>
                  {entry.sourceRunId && (
                    <Button
                      variant="ghost"
                      onClick={() => openKnowledgeTask(project.id, entry.sourceRunId as string)}
                    >
                      Open source task
                    </Button>
                  )}
                </div>
              ))}
            <Button variant="ghost" onClick={() => navigateWorkspace('project-settings')}>
              Review saved knowledge
            </Button>
          </details>
        )}
        {snapshot?.recentChanges && (
          <details>
            <summary className="min-h-11 py-3">Recent local commits</summary>
            <pre className="task-input whitespace-pre-wrap break-words">
              {snapshot.recentChanges}
            </pre>
            <p className="task-muted">
              Local snapshot when this view opened. No remote fetch was made.
            </p>
          </details>
        )}
        {(error || knowledgeError) && (
          <p role="status" className="task-muted">
            Some project context is unavailable: {error || knowledgeError}
          </p>
        )}
      </div>
    </details>
  );
}
