import {
  ArrowRight,
  BookOpen,
  Code2,
  FileText,
  FolderOpen,
  ListTodo,
  RefreshCw,
  Terminal,
  TestTube2,
} from 'lucide-react';
import { useState } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useContextMemoryStore } from '../../stores/contextMemoryStore';
import type { Project } from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import '../projects/project-context.css';

export function CodebaseMemoryBar({ project }: { project: Project }) {
  const { memories, scanning, refreshMemory } = useContextMemoryStore();
  const memory = memories[project.id];
  const busy = scanning[project.id] ?? false;
  const [error, setError] = useState('');
  const [allInstructions, setAllInstructions] = useState(false);
  const openTasks = memory?.openTasks.filter((task) => task.status === 'open') ?? [];
  const conventions = [...new Set(memory?.conventions ?? [])];
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
    <section className="context-overview workspace-section" aria-label="Repository context">
      <WorkspaceSectionHeading
        title="Repository context"
        action={
          <Button
            variant="ghost"
            disabled={busy || !isTauriEnvironment()}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
            {busy ? 'Reading…' : 'Refresh context'}
          </Button>
        }
      />
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {busy && <LoadingState label="Reading project files…" compact={!!memory} />}
      {!memory ? (
        !busy && (
          <EmptyState
            icon={FolderOpen}
            title="Get to know this repository"
            description={
              isTauriEnvironment()
                ? 'Read project files to bring its instructions, tools and planned work together.'
                : 'Open the desktop app to read repository context.'
            }
            action={
              isTauriEnvironment() && (
                <Button onClick={() => void refresh()}>Read project context</Button>
              )
            }
          />
        )
      ) : (
        <>
          <div className="context-map">
            <div className="context-project-node">
              <span className="context-project-icon">
                <FolderOpen size={28} aria-hidden="true" />
              </span>
              <h3>{project.name}</h3>
              <p>{memory.summary}</p>
              {memory.techStack.length > 0 && (
                <ul className="context-technologies" aria-label="Technologies">
                  {[...new Set(memory.techStack)].map((technology) => (
                    <li key={technology}>
                      <Code2 size={14} aria-hidden="true" />
                      {technology}
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="ghost" onClick={() => navigateWorkspace('topology')}>
                Explore codebase
                <ArrowRight size={15} />
              </Button>
            </div>
            <div className="context-source-tree">
              <h3>Source files</h3>
              <ul>
                {[...new Set(memory.sourceFilesDetected)].map((file) => (
                  <li key={file}>
                    <FileText size={18} aria-hidden="true" />
                    <span>{file}</span>
                  </li>
                ))}
              </ul>
              {memory.sourceFilesDetected.length === 0 && (
                <p className="task-muted">No supported context files found.</p>
              )}
            </div>
          </div>
          <p className="context-read-time">
            Last read {new Date(memory.lastScannedAt).toLocaleString()}
          </p>
          <div className="context-detail-grid">
            <section className="context-panel">
              <h3>
                <BookOpen size={18} aria-hidden="true" />
                Project instructions
              </h3>
              {conventions.length ? (
                <>
                  <ol className="context-instructions">
                    {(allInstructions ? conventions : conventions.slice(0, 3)).map(
                      (value, index) => (
                        <li key={value}>
                          <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                          <p>{value}</p>
                        </li>
                      ),
                    )}
                  </ol>
                  {conventions.length > 3 && (
                    <Button
                      variant="ghost"
                      aria-expanded={allInstructions}
                      onClick={() => setAllInstructions(!allInstructions)}
                    >
                      {allInstructions
                        ? 'Show fewer'
                        : `View all ${conventions.length} instructions`}
                    </Button>
                  )}
                </>
              ) : (
                <p className="task-muted">No project instructions found.</p>
              )}
            </section>
            <section className="context-panel">
              <h3>
                <Terminal size={18} aria-hidden="true" />
                Build & test
              </h3>
              {[
                { title: 'Build', values: memory.buildCommands, icon: Terminal },
                { title: 'Test', values: memory.testCommands, icon: TestTube2 },
              ].map(
                ({ title, values, icon: Icon }) =>
                  values.length > 0 && (
                    <div className="context-command-group" key={title}>
                      <h4>
                        <Icon size={14} aria-hidden="true" />
                        {title}
                      </h4>
                      {[...new Set(values)].map((command) => (
                        <code key={command}>{command}</code>
                      ))}
                    </div>
                  ),
              )}
              {!memory.buildCommands.length && !memory.testCommands.length && (
                <p className="task-muted">No build or test commands found.</p>
              )}
            </section>
          </div>
          <section className="context-planned-work">
            <div className="context-section-heading">
              <h3>
                <ListTodo size={18} aria-hidden="true" />
                Open work<span className="context-count">{openTasks.length}</span>
              </h3>
              <Button variant="ghost" onClick={() => navigateWorkspace('repo-todos')}>
                View repo TODOs
                <ArrowRight size={15} />
              </Button>
            </div>
            {openTasks.length ? (
              <ul>
                {openTasks.slice(0, 3).map((task) => (
                  <li key={task.id}>
                    <span className="context-open-marker" aria-hidden="true" />
                    <span>{task.title}</span>
                    <small>{task.sourceFile}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="task-muted">No open TODOs found in repository files.</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
