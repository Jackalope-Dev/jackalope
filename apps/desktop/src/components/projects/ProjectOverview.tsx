import { Badge, Disclosure, DisclosureSummary, Panel, Stat } from '@jackalope/ui';
import {
  Activity,
  ArrowRight,
  FolderOpen,
  GitBranch,
  ListTodo,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { returnToProject } from '../../lib/project-return';
import { queueSnapshot } from '../../lib/queue';
import { nativeTask } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from '../layout/navigation';
import { ProjectReturn } from '../tasks/ProjectReturn';
import type { Readiness } from '../tasks/WorkspaceReadiness';
import { Button } from '../ui/button';
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
  const [integrated, setIntegrated] = useState<string[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [busyReadiness, setBusyReadiness] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');

  const fetchReadiness = useCallback(async (path: string) => {
    if (!isTauriEnvironment()) return;
    setBusyReadiness(true);
    try {
      const data = await nativeTask<Readiness>('project_readiness', { path });
      setReadiness(data);
    } catch {
      // Readiness is best-effort for overview cards
    } finally {
      setBusyReadiness(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    if (isTauriEnvironment()) {
      void queueSnapshot()
        .then((value) => {
          if (alive) setIntegrated(value.mergedRunIds);
        })
        .catch((cause) => {
          if (alive) setError(String(cause));
        });
    }
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (project?.path) {
      void fetchReadiness(project.path);
    }
  }, [project?.path, fetchReadiness]);

  const unfinished = project ? returnToProject(runs, project.id, integrated) : [];
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
      {error && (
        <InlineNotice tone="error">Integration receipts could not be loaded. {error}</InlineNotice>
      )}

      {project ? (
        <div className="workspace-sections">
          {/* Workspace Page Heading */}
          <WorkspaceHeading
            title={project.name}
            description={
              <div className="project-heading-description">
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
              </div>
            }
            action={
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => {
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
                    navigateWorkspace('kanban');
                  }}
                >
                  <ListTodo size={14} />
                  Tasks board
                </Button>
              </div>
            }
          />

          {/* 4-Card Status Overview Grid */}
          <div className="project-stat-grid">
            {/* Git Branch Card */}
            <Panel className="project-stat-card">
              <Stat
                label={
                  <span className="project-stat-label-row">
                    <span>Git branch</span>
                    <GitBranch size={16} className="shrink-0" aria-hidden="true" />
                  </span>
                }
                value={
                  <span className="project-stat-value-text">
                    {readiness?.branch || project.gitBranch || 'Default branch'}
                  </span>
                }
                description={
                  readiness?.changes ? (
                    <span className="text-amber-500 font-medium">Uncommitted changes</span>
                  ) : (
                    <span className="project-stat-desc">Working tree clean</span>
                  )
                }
              />
              <div className="project-stat-footer">
                {readiness?.head ? (
                  <span className="font-mono">commit {readiness.head.slice(0, 7)}</span>
                ) : (
                  <span>Repository tracked</span>
                )}
              </div>
            </Panel>

            {/* Verification Check Card */}
            <Panel className="project-stat-card">
              <Stat
                label={
                  <span className="project-stat-label-row">
                    <span>Verification</span>
                    <ShieldCheck size={16} className="shrink-0" aria-hidden="true" />
                  </span>
                }
                value={
                  <span
                    className="project-stat-value-text"
                    title={savedVerify || readiness?.verifyCommand || undefined}
                  >
                    {savedVerify || readiness?.verifyCommand || 'Not configured'}
                  </span>
                }
                description={
                  <span className="project-stat-desc">
                    {savedVerify
                      ? 'Runs after task execution'
                      : readiness?.verifyCommand
                        ? 'Suggested check available'
                        : 'Set up in project settings'}
                  </span>
                }
              />
              <div className="project-stat-footer">
                {savedVerify ? (
                  <Badge variant="outline">Active check</Badge>
                ) : readiness?.verifyCommand ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      useProjectStore.getState().updateProjectPreferences(project.id, {
                        verifyCommand: readiness.verifyCommand ?? undefined,
                        autoVerify: true,
                      });
                      setSavedNotice('Verification check enabled.');
                    }}
                  >
                    Enable check
                    <ArrowRight size={13} />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigateWorkspace('project-settings')}
                  >
                    Configure
                    <ArrowRight size={13} />
                  </Button>
                )}
              </div>
            </Panel>

            {/* Active Work Card */}
            <Panel className="project-stat-card">
              <Stat
                label={
                  <span className="project-stat-label-row">
                    <span>Active work</span>
                    <Activity size={16} className="shrink-0" aria-hidden="true" />
                  </span>
                }
                value={
                  <span className="project-stat-value-text">{unfinished.length} in progress</span>
                }
                description={
                  <span className="project-stat-desc">
                    {unfinished.length > 0
                      ? `${unfinished.length} task${unfinished.length > 1 ? 's' : ''} awaiting action`
                      : 'All active work completed'}
                  </span>
                }
              />
              <div className="project-stat-footer">
                <span>{deliveries.length} merged</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    useWorkViewStore.getState().setScope('project');
                    useExecutionStore.getState().select(null);
                    navigateWorkspace('kanban');
                  }}
                >
                  View board
                  <ArrowRight size={13} />
                </Button>
              </div>
            </Panel>

            {/* Environment Readiness Card */}
            <Panel className="project-stat-card">
              <Stat
                label={
                  <span className="project-stat-label-row">
                    <span>Environment</span>
                    <Terminal size={16} className="shrink-0" aria-hidden="true" />
                  </span>
                }
                value={
                  <span className="project-stat-value-text">
                    {readiness?.dependenciesMissing
                      ? 'Missing deps'
                      : readiness?.missingConfiguration?.length
                        ? 'Missing config'
                        : 'Environment ready'}
                  </span>
                }
                description={
                  readiness?.dependenciesMissing ? (
                    <span className="text-amber-500 font-medium">node_modules not found</span>
                  ) : readiness?.missingConfiguration?.length ? (
                    <span className="text-amber-500 font-medium">
                      {readiness.missingConfiguration.length} missing env key
                      {readiness.missingConfiguration.length > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="project-stat-desc">Ready for agent execution</span>
                  )
                }
              />
              <div className="project-stat-footer">
                <span>Local runtime</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyReadiness}
                  loading={busyReadiness}
                  loadingLabel="Checking…"
                  onClick={() => void fetchReadiness(project.path)}
                >
                  <RefreshCw size={13} className="mr-1" />
                  Refresh
                </Button>
              </div>
            </Panel>
          </div>

          {/* Active Tasks Section */}
          <section className="workspace-section workspace-stack">
            <WorkspaceSectionHeading
              title="Active tasks"
              description="Pick up where you left off with in-progress and reviewable work."
              action={
                unfinished.length > 0 ? (
                  <Badge variant="outline">{unfinished.length} in progress</Badge>
                ) : undefined
              }
            />
            <ProjectReturn
              key={project.id}
              project={project}
              runs={runs}
              integratedIds={integrated}
              onOpen={(id) => useWorkViewStore.getState().open(id)}
            />
          </section>

          {/* Workspace Commands & Configuration */}
          <section className="workspace-section workspace-stack">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <WorkspaceSectionHeading
                title="Workspace setup"
                description="Environment readiness and automated task lifecycle commands."
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigateWorkspace('project-settings')}
              >
                <Settings2 size={14} className="mr-1" />
                Project settings
                <ArrowRight size={14} className="ml-1" />
              </Button>
            </div>

            <Panel className="p-5 space-y-4">
              {readiness?.dependenciesMissing && (
                <InlineNotice tone="warning">
                  This workspace has no node_modules folder. Dependencies may need installing before
                  work can run.
                </InlineNotice>
              )}
              {!!readiness?.missingConfiguration.length && (
                <InlineNotice tone="warning">
                  Configuration names missing from local environment:{' '}
                  {readiness.missingConfiguration.join(', ')}.
                </InlineNotice>
              )}

              <div className="project-commands-grid">
                <div className="project-command-card">
                  <div className="project-command-header">
                    <span className="project-command-name">Preparation</span>
                    {savedPrepare && <Badge variant="outline">Active</Badge>}
                  </div>
                  <div
                    className={`project-command-code ${
                      !savedPrepare && !readiness?.prepareCommand ? 'is-empty' : ''
                    }`}
                  >
                    {savedPrepare || readiness?.prepareCommand || 'None configured'}
                  </div>
                  {!savedPrepare && readiness?.prepareCommand ? (
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
                  ) : (
                    <div />
                  )}
                </div>

                <div className="project-command-card">
                  <div className="project-command-header">
                    <span className="project-command-name">Verification</span>
                    {savedVerify && <Badge variant="outline">Active</Badge>}
                  </div>
                  <div
                    className={`project-command-code ${
                      !savedVerify && !readiness?.verifyCommand ? 'is-empty' : ''
                    }`}
                  >
                    {savedVerify || readiness?.verifyCommand || 'None configured'}
                  </div>
                  {!savedVerify && readiness?.verifyCommand ? (
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
                    <div />
                  )}
                </div>

                <div className="project-command-card">
                  <div className="project-command-header">
                    <span className="project-command-name">Preview</span>
                    {savedPreview && <Badge variant="outline">Active</Badge>}
                  </div>
                  <div
                    className={`project-command-code ${
                      !savedPreview && !readiness?.previewCommand ? 'is-empty' : ''
                    }`}
                  >
                    {savedPreview || readiness?.previewCommand || 'None configured'}
                  </div>
                  {!savedPreview && readiness?.previewCommand ? (
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
                  ) : (
                    <div />
                  )}
                </div>
              </div>

              {savedNotice && <p className="text-xs text-accent font-medium">{savedNotice}</p>}

              {!!readiness?.changes && (
                <Disclosure className="pt-2 border-t border-[var(--color-border-subtle)]">
                  <DisclosureSummary>View uncommitted local changes</DisclosureSummary>
                  <pre className="task-input whitespace-pre-wrap break-words mt-2 max-h-48 overflow-y-auto text-xs font-mono text-[var(--color-text-primary)]">
                    {readiness.changes}
                  </pre>
                </Disclosure>
              )}
            </Panel>
          </section>

          {/* Recent Deliveries */}
          {deliveries.length > 0 && (
            <section className="workspace-section workspace-stack">
              <WorkspaceSectionHeading
                title="Recent deliveries"
                description="Completed work integrated locally into your repository."
              />
              <div className="space-y-2">
                {deliveries.map((run) => (
                  <Panel
                    key={run.id}
                    className="p-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm break-words text-[var(--color-text-primary)]">
                        {taskTitle(run.prompt)}
                      </p>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                        Integrated locally ·{' '}
                        {new Date(run.startedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => useWorkViewStore.getState().open(run.id, 'delivery')}
                    >
                      View delivery
                      <ArrowRight size={13} className="ml-1" />
                    </Button>
                  </Panel>
                ))}
              </div>
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
