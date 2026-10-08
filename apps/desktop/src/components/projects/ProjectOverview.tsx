import { Badge, Disclosure, DisclosureSummary, SettingGroup, SettingRow } from '@jackalope/ui';
import {
  FolderOpen,
  GitBranch,
  ListTodo,
  MonitorPlay,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { returnToProject } from '../../lib/project-return';
import type { WorkItem } from '../../lib/task-collection';
import { nativeTask } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { observeLiveSessions, useLiveSessionStore } from '../../stores/liveSessionStore';
import { observeManagedTasks, useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from '../layout/navigation';
import { IssuePicker } from '../tasks/IssuePicker';
import { ProjectReturn } from '../tasks/ProjectReturn';
import type { Readiness } from '../tasks/WorkspaceReadiness';
import { Button } from '../ui/button';
import { DismissButton } from '../ui/DismissButton';
import { EmptyState } from '../ui/EmptyState';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import './project-overview.css';

export function ProjectOverview({ onOpenProject }: { onOpenProject: () => void }) {
  const project = useProjectStore((state) =>
    state.projects.find((p) => p.id === state.activeProjectId),
  );
  const runs = useExecutionStore((state) => state.runs);
  const historyError = useExecutionStore((state) => state.historyError);
  const {
    sessions,
    runs: sessionRuns,
    error: sessionError,
  } = useLiveSessionStore(
    useShallow((s) => ({ sessions: s.sessions, runs: s.runs, error: s.error })),
  );
  const { queue, error: queueError } = useManagedTaskStore(
    useShallow((s) => ({ queue: s.queue, error: s.error })),
  );
  const ideas = useTaskStore((state) => state.tasks);
  const integrated = queue.mergedRunIds;
  const allRuns = useMemo(
    () => [...new Map([...runs, ...sessionRuns].map((run) => [run.id, run])).values()],
    [runs, sessionRuns],
  );
  const [readinessResult, setReadiness] = useState<{ path: string; value: Readiness } | null>(null);
  const readiness = readinessResult?.path === project?.path ? readinessResult?.value : null;
  const readinessRequest = useRef(0);
  const [readinessError, setReadinessError] = useState('');
  const [busyReadiness, setBusyReadiness] = useState(false);
  const error = queueError || sessionError || historyError;
  const [savedNotice, setSavedNotice] = useState('');

  const fetchReadiness = useCallback(async (path: string) => {
    if (!isTauriEnvironment()) return;
    const request = ++readinessRequest.current;
    setBusyReadiness(true);
    setReadiness(null);
    setReadinessError('');
    try {
      const data = await nativeTask<Readiness>('project_readiness', { path });
      if (request === readinessRequest.current) setReadiness({ path, value: data });
    } catch (cause) {
      if (request === readinessRequest.current) setReadinessError(String(cause));
    } finally {
      if (request === readinessRequest.current) setBusyReadiness(false);
    }
  }, []);

  useEffect(observeManagedTasks, []);
  useEffect(() => observeLiveSessions(), []);

  useEffect(() => {
    if (project?.path) {
      void fetchReadiness(project.path);
    }
    return () => {
      readinessRequest.current++;
    };
  }, [project?.path, fetchReadiness]);

  const unfinished = useMemo(
    () =>
      project ? returnToProject(allRuns, project.id, integrated, { ideas, sessions, queue }) : [],
    [allRuns, project, integrated, ideas, sessions, queue],
  );
  const openTask = (item: WorkItem) => {
    useExecutionStore.getState().select(null);
    useManagedTaskStore.getState().select(item.managed?.id ?? null);
    if (item.managed) {
      navigateWorkspace('kanban');
    } else if (item.session) {
      useLiveSessionStore.getState().select(item.session.id);
      navigateWorkspace('live-sessions');
    } else if (item.run) {
      useWorkViewStore.getState().open(item.run.id);
    } else {
      useWorkViewStore.getState().setScope('project');
      navigateWorkspace('kanban');
    }
  };
  const deliveries = project
    ? runs
        .filter((run) => run.projectId === project.id && integrated.includes(run.id))
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 3)
    : [];

  const savedPrepare = project?.preferences?.prepareCommand;
  const savedVerify = project?.preferences?.verifyCommand;
  const savedPreview = project?.preferences?.previewCommand;

  return (
    <WorkspacePage>
      {error && <InlineNotice tone="error">Task history may be incomplete. {error}</InlineNotice>}
      {readinessError && (
        <InlineNotice tone="error">
          Repository status is unavailable. {readinessError}
          {project && (
            <Button
              variant="outline"
              disabled={busyReadiness}
              onClick={() => void fetchReadiness(project.path)}
            >
              Retry repository check
            </Button>
          )}
        </InlineNotice>
      )}

      {project ? (
        <div className="workspace-sections">
          <WorkspaceHeading
            title={project.name}
            description={
              <span className="project-heading-description">
                {project.description && (
                  <span className="text-[var(--color-text-secondary)]">{project.description}</span>
                )}
                <button
                  type="button"
                  className="project-path-pill"
                  title="Click to copy path"
                  onClick={() => void navigator.clipboard.writeText(project.path)}
                >
                  {project.path}
                </button>
              </span>
            }
            action={
              <div className="workspace-actions">
                <Button
                  size="sm"
                  onClick={() => {
                    useManagedTaskStore.getState().select(null);
                    useExecutionStore.getState().select(null);
                    useLiveSessionStore.getState().select(null);
                    useProjectStore.getState().selectProject(project.id);
                    navigateWorkspace('live-sessions');
                  }}
                >
                  <Plus size={14} />
                  New task
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    useWorkViewStore.getState().setScope('project');
                    useExecutionStore.getState().select(null);
                    useManagedTaskStore.getState().select(null);
                    navigateWorkspace('kanban');
                  }}
                >
                  <ListTodo size={14} />
                  Tasks board
                </Button>
              </div>
            }
          />

          <section className="workspace-section workspace-stack">
            <WorkspaceSectionHeading
              title="Active tasks"
              action={
                unfinished.length > 0 ? (
                  <Badge variant="outline">{unfinished.length} open</Badge>
                ) : undefined
              }
            />
            <ProjectReturn
              key={project.id}
              items={unfinished}
              runs={allRuns}
              queue={queue}
              onOpen={openTask}
            />
          </section>

          <Disclosure>
            <DisclosureSummary>Start from an issue</DisclosureSummary>
            <IssuePicker
              projectPath={project.path}
              onDraft={(prompt) => {
                const key = `jackalope-live-start:${project.id}`;
                const combined = [localStorage.getItem(key), prompt].filter(Boolean).join('\n\n');
                if (new TextEncoder().encode(combined).length > 12000)
                  throw new Error(
                    'Your existing task draft is full. Send or shorten it before adding this issue.',
                  );
                localStorage.setItem(key, combined);
                useLiveSessionStore.getState().select(null);
                navigateWorkspace('live-sessions');
              }}
            />
          </Disclosure>

          <section className="workspace-section workspace-stack" aria-label="Readiness">
            <WorkspaceSectionHeading
              title="Readiness"
              action={
                isTauriEnvironment() ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyReadiness}
                    loading={busyReadiness}
                    loadingLabel="Checking…"
                    onClick={() => void fetchReadiness(project.path)}
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    Check again
                  </Button>
                ) : undefined
              }
            />
            <SettingGroup className="project-readiness">
              <SettingRow
                title={
                  <span className="project-ready-title">
                    <GitBranch size={16} aria-hidden="true" />
                    {project.plainFolder ? 'Folder' : 'Branch'}
                  </span>
                }
                description={
                  project.plainFolder ? (
                    'Not a Git repository. Tasks run in this folder; use Git to give each task its own worktree.'
                  ) : (
                    <>
                      <code>{readiness?.branch || project.gitBranch || 'Default branch'}</code>
                      {' · '}
                      {!readiness ? (
                        busyReadiness ? (
                          'Checking repository…'
                        ) : (
                          'Status unavailable'
                        )
                      ) : readiness.changes ? (
                        <span className="project-ready-warning">Uncommitted changes</span>
                      ) : (
                        'Working tree clean'
                      )}
                      {readiness?.head && ` · ${readiness.head.slice(0, 7)}`}
                    </>
                  )
                }
              >
                {!!readiness?.changes && (
                  <Button variant="outline" size="sm" onClick={() => navigateWorkspace('changes')}>
                    Review changes
                  </Button>
                )}
              </SettingRow>
              <SettingRow
                title={
                  <span className="project-ready-title">
                    <ShieldCheck size={16} aria-hidden="true" />
                    Verification
                  </span>
                }
                description={
                  savedVerify ? (
                    <>
                      <code>{savedVerify}</code>
                      {project.preferences?.autoVerify
                        ? ' · runs after each task'
                        : ' · runs when you ask'}
                    </>
                  ) : readiness?.verifyCommand ? (
                    <>
                      Suggested: <code>{readiness.verifyCommand}</code>
                    </>
                  ) : (
                    'Not configured. Tasks finish without an automatic check.'
                  )
                }
              >
                {!savedVerify &&
                  (readiness?.verifyCommand ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        useProjectStore.getState().updateProjectPreferences(project.id, {
                          verifyCommand: readiness.verifyCommand ?? undefined,
                          autoVerify: true,
                        });
                        setSavedNotice('Verification check saved.');
                      }}
                    >
                      Use suggested
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateWorkspace('project-settings')}
                    >
                      Configure
                    </Button>
                  ))}
              </SettingRow>
              <SettingRow
                title={
                  <span className="project-ready-title">
                    <Terminal size={16} aria-hidden="true" />
                    Setup
                  </span>
                }
                description={
                  !readiness ? (
                    busyReadiness ? (
                      'Inspecting the workspace…'
                    ) : (
                      'Not inspected yet.'
                    )
                  ) : readiness.dependenciesMissing ? (
                    <span className="project-ready-warning">
                      Dependencies may need installing (no node_modules folder).
                    </span>
                  ) : readiness.missingConfiguration.length ? (
                    <span className="project-ready-warning">
                      Missing environment keys: {readiness.missingConfiguration.join(', ')}
                    </span>
                  ) : savedPrepare ? (
                    <>
                      <code>{savedPrepare}</code> · runs before each task
                    </>
                  ) : readiness.prepareCommand ? (
                    <>
                      Suggested: <code>{readiness.prepareCommand}</code>
                    </>
                  ) : (
                    'No missing setup detected.'
                  )
                }
              >
                {!savedPrepare && readiness?.prepareCommand && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      useProjectStore.getState().updateProjectPreferences(project.id, {
                        prepareCommand: readiness.prepareCommand ?? undefined,
                      });
                      setSavedNotice('Preparation command saved.');
                    }}
                  >
                    Use suggested
                  </Button>
                )}
              </SettingRow>
              <SettingRow
                title={
                  <span className="project-ready-title">
                    <MonitorPlay size={16} aria-hidden="true" />
                    Preview
                  </span>
                }
                description={
                  savedPreview ? (
                    <code>{savedPreview}</code>
                  ) : readiness?.previewCommand ? (
                    <>
                      Suggested: <code>{readiness.previewCommand}</code>
                    </>
                  ) : (
                    'No preview command.'
                  )
                }
              >
                {!savedPreview && readiness?.previewCommand && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      useProjectStore.getState().updateProjectPreferences(project.id, {
                        previewCommand: readiness.previewCommand ?? undefined,
                      });
                      setSavedNotice('Preview command saved.');
                    }}
                  >
                    Use suggested
                  </Button>
                )}
              </SettingRow>
            </SettingGroup>
            {savedNotice && (
              <InlineNotice
                tone="success"
                action={<DismissButton onDismiss={() => setSavedNotice('')} />}
              >
                {savedNotice}
              </InlineNotice>
            )}
          </section>

          {deliveries.length > 0 && (
            <section className="workspace-section workspace-stack">
              <WorkspaceSectionHeading title="Recent deliveries" />
              <SettingGroup>
                {deliveries.map((run) => (
                  <SettingRow
                    key={run.id}
                    title={taskTitle(run.prompt)}
                    description={`Integrated locally · ${new Date(run.startedAt).toLocaleDateString(
                      undefined,
                      { month: 'short', day: 'numeric', year: 'numeric' },
                    )}`}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => useWorkViewStore.getState().open(run.id, 'delivery')}
                    >
                      View delivery
                    </Button>
                  </SettingRow>
                ))}
              </SettingGroup>
            </section>
          )}
        </div>
      ) : (
        <EmptyState
          icon={FolderOpen}
          title="Start with a project"
          description="Open a local project or create a new one."
          action={<Button onClick={onOpenProject}>Add project</Button>}
        />
      )}
    </WorkspacePage>
  );
}
