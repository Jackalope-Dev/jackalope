import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import './core-workflow.css';
import { DropdownMenu as Menu } from '@jackalope/ui';
import { FolderOpen, ListTodo, MoreHorizontal, Plus, Radio, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectWorkspaceWork,
  matchesWorkFilter,
  selectedManagedTask,
  type WorkItem,
} from '../../lib/task-collection';
import { nativeTask } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import { observeManagedTasks, useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { defaultWorkView, useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from '../layout/navigation';
import { ArchivedHistory } from '../settings/ArchivedHistory';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Select, SelectItem } from '../ui/Select';
import { CaptureTask } from './CaptureTask';
import { ManagedTaskView } from './ManagedTaskView';
import { ProjectQueue } from './ProjectQueue';
import { TaskCollection } from './TaskCollection';
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
  const managed = useManagedTaskStore();
  useEffect(observeManagedTasks, []);
  const runs = useExecutionStore((state) => state.runs);
  const sessions = useLiveSessionStore((state) => state.sessions);
  const sessionRuns = useLiveSessionStore((state) => state.runs);
  useEffect(observeLiveSessions, []);
  const allRuns = useMemo(
    () => [...new Map([...runs, ...sessionRuns].map((run) => [run.id, run])).values()],
    [runs, sessionRuns],
  );
  const runners = useExecutionStore((state) => state.runners);
  const selectedId = useExecutionStore((state) => state.selectedId);
  const select = useExecutionStore((state) => state.select);
  const loading = useExecutionStore((state) => state.loading);
  const error = useExecutionStore((state) => state.error) || managed.error;
  const ideas = useTaskStore((state) => state.tasks);
  const { scope, setScope, views, setView: saveView } = useWorkViewStore();
  const projectFilter = scope === 'all' ? 'all' : (activeProjectId ?? 'unassigned');
  const [archived, setArchived] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [parallel, setParallel] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const hasWork = !!(runs.length || ideas.length || sessions.length);
  useEffect(() => {
    if (!composerFocus) return;
    setComposerExpanded(true);
    setParallel(false);
    const frame = requestAnimationFrame(() => {
      const input = document.getElementById('task-intent');
      input?.focus();
      input?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [composerFocus]);
  const viewKey = `${projectFilter}:${archived ? 'archive' : 'current'}`;
  const view = views[viewKey] ?? defaultWorkView;
  const setView = (value: typeof view) => saveView(viewKey, value);
  const integratedIds = managed.queue.mergedRunIds;
  const lastOpened = useRef<string | null>(null);
  const openItem = useCallback(
    (item: WorkItem) => {
      lastOpened.current = item.id;
      if (!item.managed) useManagedTaskStore.getState().select(null);
      if (item.managed) {
        select(null);
        useManagedTaskStore.getState().select(item.managed.id);
      } else if (item.session) {
        useLiveSessionStore.getState().select(item.session.id);
        useProjectStore.getState().selectProject(item.session.request.projectId);
        navigateWorkspace('live-sessions');
      } else if (item.run) select(item.run.id);
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
  const selected = runs.find((run) => run.id === selectedId);
  const project = projects.find(
    (p) => p.id === (projectFilter === 'all' ? activeProjectId : projectFilter),
  );
  const items = useMemo(
    () =>
      collectWorkspaceWork(
        projectFilter === 'all' ? null : projectFilter === 'unassigned' ? '' : projectFilter,
        ideas,
        allRuns,
        sessions,
        integratedIds,
        archived,
        managed.queue,
      ),
    [projectFilter, ideas, allRuns, sessions, integratedIds, archived, managed.queue],
  );
  const archiveItems = async (selected: WorkItem[], archive: boolean) => {
    const failures: string[] = [];
    const updatedRuns: string[] = [];
    for (const item of selected) {
      try {
        if (item.run) {
          await nativeTask('task_set_archived', { id: item.run.id, archived: archive });
          updatedRuns.push(item.run.id);
        } else if (item.idea) {
          useTaskStore.getState().setArchived(item.idea.id, archive);
        }
      } catch (cause) {
        failures.push(`${item.title}: ${String(cause)}`);
      }
    }
    await useExecutionStore.getState().refresh();
    if (
      useExecutionStore
        .getState()
        .runs.some((run) => updatedRuns.includes(run.id) && !!run.archivedAt !== archive)
    ) {
      await useExecutionStore.getState().refresh();
    }
    if (useExecutionStore.getState().historyError) {
      failures.push('The task list could not refresh. Retry loading history to see saved changes.');
    }
    if (failures.length) throw new Error(failures.join('\n'));
  };
  const needsYou = archived
    ? 0
    : items.filter((item) => matchesWorkFilter(item, 'attention')).length;
  const managedTask = selectedManagedTask(
    managed.queue,
    allRuns,
    managed.selectedId,
    selectedId,
    projectFilter === 'all' ? null : projectFilter,
  );
  useEffect(() => {
    if (managed.selectedId && !managedTask) useManagedTaskStore.getState().select(null);
  }, [managed.selectedId, managedTask]);
  if (managedTask)
    return (
      <ManagedTaskView
        task={managedTask}
        onBack={() => {
          managed.select(null);
          select(null);
        }}
      />
    );
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
        title={
          runs.length || ideas.length || sessions.length
            ? scope === 'all'
              ? 'All work'
              : `Work in ${project?.name ?? 'your workspace'}`
            : 'What do you want to accomplish?'
        }
        description={
          hasWork ? undefined : (
            <span>
              Describe what to build, fix, or explore, or{' '}
              <button
                type="button"
                className="task-inline-link"
                onClick={() => navigateWorkspace('repo-todos')}
              >
                find tasks in Repo TODOs &rarr;
              </button>
            </span>
          )
        }
        action={
          <div className="task-home-actions">
            {!!needsYou && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setView({
                    ...view,
                    filter: 'attention',
                  });
                  document
                    .querySelector('.task-collection')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                Needs you · {needsYou}
              </Button>
            )}
            {hasWork && (
              <Button onClick={() => onCapture()}>
                <Plus size={16} />
                New task
              </Button>
            )}
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="outline" aria-label="More work actions">
                  <MoreHorizontal size={18} />
                </Button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content className="workspace-menu" align="end" sideOffset={8}>
                  <Menu.Item
                    className="workspace-menu-item"
                    onSelect={() => {
                      useLiveSessionStore.getState().select(null);
                      navigateWorkspace('live-sessions');
                    }}
                  >
                    <Radio size={16} />
                    Open Chat
                  </Menu.Item>
                  {project && (
                    <Menu.Item
                      className="workspace-menu-item"
                      onSelect={() => navigateWorkspace('repo-todos')}
                    >
                      <ListTodo size={16} />
                      Repo TODOs
                    </Menu.Item>
                  )}
                  {project && (
                    <Menu.Item className="workspace-menu-item" onSelect={() => setParallel(true)}>
                      <Workflow size={16} />
                      Plan feature work
                    </Menu.Item>
                  )}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
        }
      />
      {composerVisible && (!hasWork || composerExpanded) && (
        <CaptureTask
          inline
          compact={!!(runs.length || ideas.length || sessions.length)}
          onClose={() => {}}
          onStarted={() => {}}
        />
      )}
      {(runs.length > 0 || ideas.length > 0 || sessions.length > 0) && (
        <div className="sr-only">
          <WorkspaceSectionHeading titleId="task-work" title="Your work" />
        </div>
      )}
      {loading && <LoadingState label={'Loading task history…'} />}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {runs.length > 0 || ideas.length > 0 || sessions.length > 0 ? (
        <TaskCollection
          key={String(archived)}
          archived={archived}
          onArchive={archiveItems}
          onBusyChange={setCleanupBusy}
          history={
            <Select
              aria-label="Task history"
              disabled={cleanupBusy}
              value={archived ? 'archive' : 'current'}
              onValueChange={(value) => setArchived(value === 'archive')}
            >
              <SelectItem value="current">Current work</SelectItem>
              <SelectItem value="archive">Archived work</SelectItem>
            </Select>
          }
          scope={
            <Select
              aria-label="Filter by project"
              value={scope}
              onValueChange={(value) => setScope(value as 'all' | 'project')}
            >
              <SelectItem value="all">All work · every project</SelectItem>
              <SelectItem value="project">
                {project?.name ?? 'No project yet'} · project work
              </SelectItem>
            </Select>
          }
          emptyState={
            <EmptyState
              icon={FolderOpen}
              title={
                archived
                  ? 'No archived tasks'
                  : projectFilter === 'all'
                    ? 'No current tasks'
                    : 'No tasks in this project'
              }
              description={
                archived
                  ? 'Tasks you archive will appear here.'
                  : 'Describe a change above, or browse repository TODOs to find tasks.'
              }
              action={
                <div className="flex items-center gap-2">
                  {projectFilter !== 'all' && (
                    <Button variant="outline" onClick={() => setScope('all')}>
                      Show all projects
                    </Button>
                  )}
                  {!archived && (
                    <Button variant="outline" onClick={() => navigateWorkspace('repo-todos')}>
                      <ListTodo size={16} />
                      Browse Repo TODOs
                    </Button>
                  )}
                </div>
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
      {archived && <ArchivedHistory />}
    </WorkspacePage>
  );
}
