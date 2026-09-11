import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import './core-workflow.css';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { FolderOpen, MoreHorizontal, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { queueSnapshot } from '../../lib/queue';
import { collectWork, type WorkItem } from '../../lib/task-collection';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Select, SelectItem } from '../ui/Select';
import { CaptureTask } from './CaptureTask';
import { ProjectQueue } from './ProjectQueue';
import { ProjectReturn } from './ProjectReturn';
import { TaskCollection, type TaskCollectionView } from './TaskCollection';
import { TaskDetail } from './TaskDetail';

export function TaskWorkspace({
  onCapture,
  onSchedule,
  composerVisible = true,
  composerFocus = 0,
}: {
  onCapture: (ideaId?: string) => void;
  onSchedule: (runId: string) => void;
  composerVisible?: boolean;
  composerFocus?: number;
}) {
  const { projects, activeProjectId } = useProjectStore();
  const runs = useExecutionStore((state) => state.runs);
  const runners = useExecutionStore((state) => state.runners);
  const selectedId = useExecutionStore((state) => state.selectedId);
  const select = useExecutionStore((state) => state.select);
  const loading = useExecutionStore((state) => state.loading);
  const error = useExecutionStore((state) => state.error);
  const ideas = useTaskStore((state) => state.tasks);
  const [projectFilter, setProjectFilter] = useState('all');
  const [parallel, setParallel] = useState(false);
  useEffect(() => {
    if (!composerFocus) return;
    setParallel(false);
    const frame = requestAnimationFrame(() => {
      const input = document.getElementById('task-intent');
      input?.focus();
      input?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [composerFocus]);
  const [view, setView] = useState<TaskCollectionView>({
    filter: 'all',
    layout: 'list',
    query: '',
  });
  const [integratedIds, setIntegratedIds] = useState<string[]>([]);
  const lastOpened = useRef<string | null>(null);
  const openItem = useCallback(
    (item: WorkItem) => {
      lastOpened.current = item.id;
      if (item.run) select(item.run.id);
      else if (item.idea) onCapture(item.idea.id);
    },
    [select, onCapture],
  );
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
  const items = useMemo(
    () =>
      collectWork(
        projectFilter === 'all' ? null : projectFilter === 'unassigned' ? '' : projectFilter,
        ideas,
        runs,
        integratedIds,
      ),
    [projectFilter, ideas, runs, integratedIds],
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
    <WorkspacePage className="task-home">
      <WorkspaceHeading
        title="What do you want to accomplish?"
        description="Describe what to build, fix, or explore."
        action={
          <div className="task-home-actions">
            {!!(needsInput || ready) && (
              <a className="task-attention-link" href="#task-work">
                {[
                  needsInput
                    ? `${needsInput} ${needsInput === 1 ? 'needs' : 'need'} attention`
                    : '',
                  ready ? `${ready} ready to review` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </a>
            )}
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
                      Plan feature work · {project.name}
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            )}
          </div>
        }
      />
      {composerVisible && <CaptureTask inline onClose={() => {}} onStarted={() => {}} />}
      {(runs.length > 0 || ideas.length > 0) && (
        <div className="mt-8">
          <WorkspaceSectionHeading titleId="task-work" title="Your work" />
        </div>
      )}
      {project && (
        <ProjectReturn
          key={project.id}
          project={project}
          runs={runs}
          integratedIds={integratedIds}
          onOpen={select}
        />
      )}
      {loading && <LoadingState label={'Loading task history…'} />}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
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
          onOpen={openItem}
        />
      ) : null}
    </WorkspacePage>
  );
}
