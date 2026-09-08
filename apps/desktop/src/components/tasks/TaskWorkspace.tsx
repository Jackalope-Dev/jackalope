import './core-workflow.css';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Bot, Check, FolderOpen, MoreHorizontal, Plus, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { queueSnapshot } from '../../lib/queue';
import { collectWork } from '../../lib/task-collection';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Select, SelectItem } from '../ui/Select';
import { ProjectQueue } from './ProjectQueue';
import { TaskCollection, type TaskCollectionView } from './TaskCollection';
import { TaskDetail } from './TaskDetail';

export function TaskWorkspace({
  onCapture,
  onSchedule,
}: {
  onCapture: (ideaId?: string) => void;
  onSchedule: (runId: string) => void;
}) {
  const { projects, activeProjectId } = useProjectStore();
  const { runs, runners, selectedId, select, loading, error } = useExecutionStore();
  const ideas = useTaskStore((state) => state.tasks);
  const [projectFilter, setProjectFilter] = useState('all');
  const [parallel, setParallel] = useState(false);
  const [view, setView] = useState<TaskCollectionView>({
    filter: 'all',
    layout: 'list',
    query: '',
  });
  const [integratedIds, setIntegratedIds] = useState<string[]>([]);
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId || !lastOpened.current) return;
    const row = document.getElementById(`work-item-${lastOpened.current}`);
    const group = row?.closest('details');
    if (group) group.open = true;
    row?.focus();
  }, [selectedId]);
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let alive = true;
    const read = () => {
      void queueSnapshot()
        .then((queue) => {
          if (alive) setIntegratedIds(queue.mergedRunIds);
        })
        .catch(() => {
          if (alive) setIntegratedIds([]);
        });
    };
    read();
    const timer = setInterval(read, 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const selected = runs.find((run) => run.id === selectedId);
  const project = projects.find(
    (p) => p.id === (projectFilter === 'all' ? activeProjectId : projectFilter),
  );
  const items = collectWork(
    projectFilter === 'all' ? null : projectFilter === 'unassigned' ? '' : projectFilter,
    ideas,
    runs,
    integratedIds,
  );
  const needsInput = items.filter((item) => item.stage === 'attention').length;
  const ready = items.filter((item) => item.stage === 'review').length;
  if (selected)
    return (
      <TaskDetail
        key={selected.id}
        run={selected}
        onBack={() => select(null)}
        onSchedule={() => onSchedule(selected.id)}
        onCapture={onCapture}
        integrated={integratedIds.includes(selected.id)}
      />
    );
  if (parallel && project)
    return <ProjectQueue project={project} onBack={() => setParallel(false)} />;
  return (
    <section className="task-page task-home">
      <div className="task-introduction workspace-section-heading">
        <div>
          <h1 className="task-hero-title">Tasks</h1>
          <p className="task-muted mt-3">
            {needsInput || ready
              ? [
                  needsInput
                    ? `${needsInput} ${needsInput === 1 ? 'task needs' : 'tasks need'} you`
                    : '',
                  ready ? `${ready} ready to review` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : projectFilter === 'all'
                ? 'Work across all your projects.'
                : projectFilter === 'unassigned'
                  ? 'Ideas without a project.'
                  : `Work in ${project?.name ?? 'this project'}.`}
          </p>
        </div>
        <div className="task-home-actions">
          <Button onClick={() => onCapture()}>
            <Plus size={18} />
            New task
          </Button>
          {project && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="ghost" aria-label="More task actions">
                  <MoreHorizontal size={18} />
                </Button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  className="workspace-menu"
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                >
                  <Menu.Item className="workspace-menu-item" onSelect={() => setParallel(true)}>
                    <Workflow size={16} />
                    Organize parallel work · {project.name}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          )}
        </div>
      </div>
      {loading && (
        <p role="status" className="task-muted">
          Loading task history…
        </p>
      )}
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      {runs.length > 0 || ideas.length > 0 ? (
        <TaskCollection
          scope={
            <Select
              aria-label="Filter by project"
              value={projectFilter}
              onValueChange={setProjectFilter}
            >
              <SelectItem value="all">All projects</SelectItem>
              <SelectItem value="unassigned">No project yet</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </Select>
          }
          emptyState={
            <EmptyState
              icon={FolderOpen}
              title="No tasks in this project"
              description="Choose another project to find your work, or create a new task."
              action={
                <Button variant="outline" onClick={() => setProjectFilter('all')}>
                  Show all projects
                </Button>
              }
            />
          }
          view={view}
          onViewChange={setView}
          items={items}
          runners={runners}
          onOpen={(item) => {
            lastOpened.current = item.id;
            if (item.run) select(item.run.id);
            else if (item.idea) onCapture(item.idea.id);
          }}
        />
      ) : !loading && !error ? (
        <div className="task-welcome">
          <h2>What would you like to work on?</h2>
          <p className="task-muted">
            Use New task to describe an outcome. Start with an agent, or save the idea for later.
          </p>
          <ol className="task-welcome-steps">
            <li>
              <FolderOpen size={20} />
              <div>
                <h3>Choose a project</h3>
                <p>Give the work a home when you’re ready to start.</p>
              </div>
            </li>
            <li>
              <Bot size={20} />
              <div>
                <h3>Let an agent work</h3>
                <p>Follow progress and answer questions here.</p>
              </div>
            </li>
            <li>
              <Check size={20} />
              <div>
                <h3>Review the result</h3>
                <p>Inspect the changes and decide what happens next.</p>
              </div>
            </li>
          </ol>
        </div>
      ) : null}
    </section>
  );
}
