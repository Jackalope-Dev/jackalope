import './core-workflow.css';
import { FolderOpen, Plus, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { queueSnapshot } from '../../lib/queue';
import { collectWork } from '../../lib/task-collection';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { Button } from '../ui/button';
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
            {needsInput
              ? `${needsInput} ${needsInput === 1 ? 'task needs' : 'tasks need'} you.`
              : ready
                ? `${ready} ${ready === 1 ? 'result is' : 'results are'} ready to review.`
                : items.length
                  ? 'Pick up a result, follow your progress, or start something new.'
                  : 'Save an idea or start an agent task.'}
          </p>
        </div>
        <Button onClick={() => onCapture()}>
          <Plus size={18} />
          New task
        </Button>
      </div>
      <div className="work-scope">
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
        {project && (
          <Button variant="ghost" onClick={() => setParallel(true)}>
            <Workflow size={16} />
            Organize parallel work · {project.name}
          </Button>
        )}
      </div>
      {!projects.length && (
        <p className="task-muted mb-5 flex items-center gap-2">
          <FolderOpen size={18} />
          Save ideas freely. Choose a repository when you’re ready to run one.
        </p>
      )}
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
      {items.length > 0 && (
        <TaskCollection
          view={view}
          onViewChange={setView}
          items={items}
          runners={runners}
          onOpen={(item) => {
            if (item.run) select(item.run.id);
            else if (item.idea) onCapture(item.idea.id);
          }}
        />
      )}
    </section>
  );
}
