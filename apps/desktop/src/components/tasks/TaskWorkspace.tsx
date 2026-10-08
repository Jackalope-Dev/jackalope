import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import './core-workflow.css';
import { DropdownMenu as Menu } from '@jackalope/ui';
import { FolderOpen, ListTodo, MoreHorizontal, Plus, Radio, Workflow } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';
import {
  collectWorkspaceWork,
  matchesWorkFilter,
  selectedManagedTask,
  type WorkItem,
} from '../../lib/task-collection';
import { nativeTask } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useOnboardingStore } from '../../stores/onboardingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { defaultWorkView, useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from '../layout/navigation';
import { SessionStart } from '../sessions/SessionStart';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceModeHome } from './WorkspaceModeHome';

const ManagedTaskView = lazy(() =>
  import('./ManagedTaskView').then((m) => ({ default: m.ManagedTaskView })),
);
const LiveSessionView = lazy(() =>
  import('../sessions/LiveSessionView').then((m) => ({ default: m.LiveSessionView })),
);
const TaskDetail = lazy(() => import('./TaskDetail').then((m) => ({ default: m.TaskDetail })));
const ProjectQueue = lazy(() =>
  import('./ProjectQueue').then((m) => ({ default: m.ProjectQueue })),
);
const TaskCollection = lazy(() =>
  import('./TaskCollection').then((m) => ({ default: m.TaskCollection })),
);
const ArchivedHistory = lazy(() =>
  import('../settings/ArchivedHistory').then((m) => ({ default: m.ArchivedHistory })),
);

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
  const { projects, activeProjectId } = useProjectStore(
    useShallow((s) => ({ projects: s.projects, activeProjectId: s.activeProjectId })),
  );
  const preset = useWorkbenchStore((state) => state.presets[activeProjectId ?? ''] ?? 'focus');
  const managed = useManagedTaskStore(
    useShallow((s) => ({
      error: s.error,
      queue: s.queue,
      selectedId: s.selectedId,
      select: s.select,
    })),
  );
  const runs = useExecutionStore((state) => state.runs);
  const sessions = useLiveSessionStore((state) => state.sessions);
  const selectedSessionId = useLiveSessionStore((state) => state.selectedId);
  const sessionRuns = useLiveSessionStore((state) => state.runs);
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
  const {
    scope,
    setScope,
    views,
    setView: saveView,
    listRequest,
    clearListRequest,
  } = useWorkViewStore(
    useShallow((s) => ({
      scope: s.scope,
      setScope: s.setScope,
      views: s.views,
      setView: s.setView,
      listRequest: s.listRequest,
      clearListRequest: s.clearListRequest,
    })),
  );
  const projectFilter = scope === 'all' ? 'all' : (activeProjectId ?? 'unassigned');
  const [archived, setArchived] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [parallel, setParallel] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const hasWork = !!(
    runs.length ||
    ideas.length ||
    sessions.length ||
    managed.queue.managedTasks?.length
  );
  const modeContext = `${activeProjectId}:${preset}`;
  const previousModeContext = useRef(modeContext);
  useEffect(() => {
    if (previousModeContext.current === modeContext) return;
    previousModeContext.current = modeContext;
    setBrowsing(false);
    setComposerExpanded(false);
    setArchived(false);
    setParallel(false);
  }, [modeContext]);
  useEffect(() => {
    if (!composerFocus) return;
    setComposerExpanded(true);
    setBrowsing(false);
    setArchived(false);
    setParallel(false);
    const frame = requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>('.task-home textarea');
      input?.focus();
      input?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [composerFocus]);
  const legacyViewKey = `${projectFilter}:${archived ? 'archive' : 'current'}`;
  const viewKey = `${legacyViewKey}:${preset}`;
  const view = views[viewKey] ??
    (preset === 'build' ? views[legacyViewKey] : undefined) ?? {
      ...defaultWorkView,
      layout: preset === 'oversee' ? ('board' as const) : ('list' as const),
    };
  const setView = (value: typeof view) => saveView(viewKey, value);
  useEffect(() => {
    if (!listRequest) return;
    const key = `${projectFilter}:current:${preset}`;
    const saved = useWorkViewStore.getState().views[key];
    saveView(key, {
      ...defaultWorkView,
      ...saved,
      layout: saved?.layout ?? (preset === 'oversee' ? 'board' : 'list'),
      filter: listRequest,
      query: '',
    });
    setBrowsing(true);
    setArchived(false);
    setParallel(false);
    clearListRequest();
  }, [listRequest, projectFilter, preset, saveView, clearListRequest]);
  const browse = (filter: string) => {
    setBrowsing(true);
    setView({ ...view, filter });
    requestAnimationFrame(() =>
      document.querySelector('.task-collection')?.scrollIntoView({ block: 'start' }),
    );
  };
  const integratedIds = managed.queue.mergedRunIds;
  const lastOpened = useRef<string | null>(null);
  const openItem = useCallback(
    (item: WorkItem) => {
      lastOpened.current = item.id;
      useLiveSessionStore.getState().select(null);
      if (!item.managed) useManagedTaskStore.getState().select(null);
      if (item.managed) {
        select(null);
        useManagedTaskStore.getState().select(item.managed.id);
      } else if (item.session) {
        useLiveSessionStore.getState().select(item.session.id);
        useProjectStore.getState().selectProject(item.session.request.projectId);
        select(null);
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
  // Session-owned attempts continue only from their chat, so open that chat instead of the
  // standalone task page (for example when arriving from a notification).
  const owningSession = selected?.liveSessionId
    ? sessions.find((session) => session.id === selected.liveSessionId)
    : undefined;
  useEffect(() => {
    if (!owningSession) return;
    useLiveSessionStore.getState().select(owningSession.id);
    select(null);
  }, [owningSession, select]);
  if (managedTask)
    return (
      <Suspense fallback={<LoadingState label="Loading task…" />}>
        <ManagedTaskView
          key={managedTask.id}
          task={managedTask}
          onBack={() => {
            managed.select(null);
            select(null);
          }}
        />
      </Suspense>
    );
  if (owningSession)
    return (
      <Suspense fallback={<LoadingState label="Loading conversation…" />}>
        <LiveSessionView
          key={owningSession.id}
          session={owningSession}
          runs={sessionRuns}
          onBack={() => useLiveSessionStore.getState().select(null)}
        />
      </Suspense>
    );
  if (selected)
    return (
      <Suspense fallback={<LoadingState label="Loading task details…" />}>
        <TaskDetail
          key={selected.id}
          run={selected}
          onBack={() => select(null)}
          onSchedule={() => onSchedule(selected.id)}
          onCapture={onCapture}
          integrated={integratedIds.includes(selected.id)}
        />
      </Suspense>
    );
  const selectedSession = sessions.find(
    (session) =>
      session.id === selectedSessionId &&
      (projectFilter === 'all' || session.request.projectId === projectFilter),
  );
  if (selectedSession)
    return (
      <Suspense fallback={<LoadingState label="Loading conversation…" />}>
        <LiveSessionView
          key={selectedSession.id}
          session={selectedSession}
          runs={sessionRuns}
          onBack={() => useLiveSessionStore.getState().select(null)}
        />
      </Suspense>
    );
  if (parallel && project)
    return (
      <Suspense fallback={<LoadingState label="Loading queue…" />}>
        <ProjectQueue project={project} onBack={() => setParallel(false)} />
      </Suspense>
    );

  return (
    <WorkspacePage className="task-home" data-mode={preset} data-browsing={browsing || undefined}>
      <WorkspaceHeading
        title={
          preset === 'focus'
            ? browsing
              ? 'Your work'
              : 'What will you focus on?'
            : preset === 'oversee'
              ? scope === 'all'
                ? 'Activity across your projects'
                : `Oversee ${project?.name ?? 'your work'}`
              : `Build in ${project?.name ?? 'your workspace'}`
        }
        description={
          preset !== 'build' || hasWork ? undefined : (
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
            {preset === 'focus' && hasWork && (
              <Button variant="outline" onClick={() => setBrowsing(!browsing)}>
                {browsing ? 'Back to focus' : 'All work'}
              </Button>
            )}
            {!!needsYou && preset === 'build' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBrowsing(true);
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
            {(hasWork || preset === 'oversee') && (preset !== 'focus' || browsing) && (
              <Button
                onClick={() => {
                  setComposerExpanded(true);
                  requestAnimationFrame(() => {
                    const input =
                      document.querySelector<HTMLTextAreaElement>('.task-home textarea');
                    input?.focus();
                    input?.scrollIntoView({ block: 'center' });
                  });
                }}
              >
                <Plus size={16} />
                New work
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
                  <Menu.Item className="workspace-menu-item" onSelect={() => onCapture()}>
                    <Radio size={16} />
                    Save a task draft
                  </Menu.Item>
                  {/* Build mode lists these as tools beneath the heading. */}
                  {project && preset !== 'build' && (
                    <Menu.Item
                      className="workspace-menu-item"
                      onSelect={() => navigateWorkspace('repo-todos')}
                    >
                      <ListTodo size={16} />
                      Repo TODOs
                    </Menu.Item>
                  )}
                  {project && preset !== 'build' && (
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
      {composerVisible &&
        ((!hasWork && preset !== 'oversee') ||
          composerExpanded ||
          (preset === 'focus' && !browsing)) && (
          <SessionStart
            embedded
            key={project?.id ?? 'none'}
            project={project}
            starters={!hasWork}
            onOpenProject={() => useOnboardingStore.getState().begin()}
          />
        )}
      {preset !== 'focus' && !archived && (
        <WorkspaceModeHome
          key={preset}
          preset={preset}
          items={items}
          filter={view.filter}
          onOpen={openItem}
          onFilter={browse}
          onPlan={() => setParallel(true)}
        />
      )}
      {preset === 'focus' && !browsing && (
        <WorkspaceModeHome
          key={preset}
          preset={preset}
          items={items}
          filter={view.filter}
          onOpen={openItem}
          onFilter={browse}
          onPlan={() => setParallel(true)}
        />
      )}
      {(runs.length > 0 || ideas.length > 0 || sessions.length > 0) && (
        <div className="sr-only">
          <WorkspaceSectionHeading titleId="task-work" title="Your work" />
        </div>
      )}
      {loading && <LoadingState label={'Loading task history…'} />}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {(preset !== 'focus' || browsing) && (hasWork || preset === 'oversee') ? (
        <Suspense fallback={<LoadingState label="Loading work list…" />}>
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
                    : 'Start new work, or browse repository TODOs to find tasks.'
                }
                action={
                  <div className="workspace-actions">
                    {projectFilter !== 'all' && projects.length > 1 && (
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
        </Suspense>
      ) : null}
      {archived && (
        <Suspense fallback={<LoadingState label="Loading archive…" />}>
          <ArchivedHistory />
        </Suspense>
      )}
    </WorkspacePage>
  );
}
