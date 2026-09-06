import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useContextMemoryStore } from '../../stores/contextMemoryStore';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';

export function CodebaseMemoryBar({
  project,
  initiallyExpanded = false,
}: {
  project: Project;
  initiallyExpanded?: boolean;
}) {
  const { memories, scanning, refreshMemory } = useContextMemoryStore();
  const memory = memories[project.id];
  const busy = scanning[project.id] ?? false;
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [error, setError] = useState('');
  const id = useId();
  const refresh = async () => {
    if (busy) return;
    setError('');
    try {
      await refreshMemory(project);
    } catch (error) {
      setError(String(error));
    }
  };
  return (
    <section className="context-summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Repository context{' '}
          {memory?.techStack.length ? `· ${memory.techStack.slice(0, 3).join(', ')}` : ''}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || !isTauriEnvironment()}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          {busy ? 'Reading…' : 'Refresh context'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="task-error mt-3">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="task-muted mt-3">
          Reading project files…
        </p>
      )}
      {expanded && (
        <div id={id} className="space-y-5 pt-4">
          {!memory ? (
            <p className="task-muted">
              {isTauriEnvironment()
                ? 'Refresh to read the repository instructions, build commands and planned work.'
                : 'Open the desktop app to read repository context.'}
            </p>
          ) : (
            <>
              <p className="task-muted">{memory.summary}</p>
              <p className="task-muted text-xs">
                Last read {new Date(memory.lastScannedAt).toLocaleString()}. Refresh after
                repository changes.
              </p>
              {memory.sourceFilesDetected.length > 0 && (
                <div>
                  <h3 className="text-base font-medium">Source files</h3>
                  <p className="task-path">{memory.sourceFilesDetected.join(' · ')}</p>
                </div>
              )}
              {[
                { title: 'Project instructions', values: memory.conventions },
                { title: 'Build commands', values: memory.buildCommands },
                { title: 'Test commands', values: memory.testCommands },
                {
                  title: 'Planned work in repository files',
                  values: memory.openTasks
                    .filter((task) => task.status === 'open')
                    .map((task) => task.title),
                },
              ]
                .filter((group) => group.values.length)
                .map((group) => (
                  <details key={group.title}>
                    <summary className="task-summary">
                      {group.title} · {group.values.length}
                    </summary>
                    <ul className="space-y-2 mt-3 text-sm text-[var(--color-text-secondary)]">
                      {[...new Set(group.values)].map((value) => (
                        <li key={value} className="break-words">
                          {value}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
