import { Badge, Disclosure, DisclosureSummary, Panel, Stat } from '@jackalope/ui';
import {
  ArrowRight,
  FolderOpen,
  GitBranch,
  ListTodo,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
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
      <WorkspaceHeading
        title={project?.name ?? 'Your project'}
        description={project?.description || project?.path}
        action={
          project && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  useLiveSessionStore.getState().select(null);
                  useProjectStore.getState().selectProject(project.id);
                  navigateWorkspace('live-sessions');
                }}
              >
                <Plus size={16} />
                New task
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  useWorkViewStore.getState().setScope('project');
                  useExecutionStore.getState().select(null);
                  navigateWorkspace('kanban');
                }}
              >
                <ListTodo size={16} />
                View tasks
              </Button>
            </div>
          )
        }
      />

      {error && (
        <InlineNotice tone="error">Integration receipts could not be loaded. {error}</InlineNotice>
      )}

      {project ? (
        <div className="workspace-sections">
          {/* Summary Status Cards */}
          <div className="workspace-card-grid">
            <Panel className="p-4 flex flex-col justify-between">
              <Stat
                label="Repository"
                value={
                  <span className="flex items-center gap-1.5 text-base font-semibold">
                    <GitBranch size={16} className="text-muted shrink-0" />
                    {readiness?.branch || project.gitBranch || 'Default branch'}
                  </span>
                }
                description={
                  readiness?.changes ? (
                    <span className="text-amber-500 font-medium">Uncommitted changes</span>
                  ) : (
                    'Working tree clean'
                  )
                }
              />
              {readiness?.head && (
                <span className="mt-2 text-xs font-mono text-muted">
                  commit {readiness.head.slice(0, 7)}
                </span>
              )}
            </Panel>

            <Panel className="p-4 flex flex-col justify-between">
              <Stat
                label="Verification check"
                value={
                  <span className="flex items-center gap-1.5 text-base font-semibold truncate">
                    <ShieldCheck size={16} className="text-muted shrink-0" />
                    <span className="truncate">
                      {savedVerify || readiness?.verifyCommand || 'Not set'}
                    </span>
                  </span>
                }
                description={
                  savedVerify
                    ? 'Runs after task execution'
                    : readiness?.verifyCommand
                      ? 'Suggested check available'
                      : 'Set up in Project settings'
                }
              />
              <div className="mt-2">
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
                      setSavedNotice('Verification check saved.');
                    }}
                  >
                    Enable suggested check
                    <ArrowRight size={14} />
                  </Button>
                ) : null}
              </div>
            </Panel>

            <Panel className="p-4 flex flex-col justify-between">
              <Stat
                label="Active work"
                value={`${unfinished.length} in progress`}
                description={
                  unfinished.length
                    ? `${unfinished.length} task${unfinished.length > 1 ? 's' : ''} require attention`
                    : 'All work completed'
                }
              />
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    useWorkViewStore.getState().setScope('project');
                    navigateWorkspace('kanban');
                  }}
                >
                  Open tasks
                  <ArrowRight size={14} />
                </Button>
              </div>
            </Panel>
          </div>

          {/* Active Work / Resume Section */}
          <section className="workspace-section workspace-stack">
            <WorkspaceSectionHeading
              title="Active tasks"
              description="Pick up where you left off with in-progress tasks."
            />
            <ProjectReturn
              key={project.id}
              project={project}
              runs={runs}
              integratedIds={integrated}
              onOpen={(id) => useWorkViewStore.getState().open(id)}
            />
          </section>

          {/* Workspace Setup & Configuration */}
          <section className="workspace-section workspace-stack">
            <div className="flex items-center justify-between">
              <WorkspaceSectionHeading
                title="Workspace setup"
                description="Environment readiness and automated commands."
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={busyReadiness}
                loading={busyReadiness}
                loadingLabel="Checking…"
                onClick={() => void fetchReadiness(project.path)}
              >
                <RefreshCw size={14} className="mr-1" />
                Refresh
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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="space-y-1">
                  <span className="text-xs text-muted font-medium">Preparation</span>
                  <p className="font-mono text-xs break-all">
                    {savedPrepare || readiness?.prepareCommand || 'None configured'}
                  </p>
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
                      Use suggested preparation
                    </Button>
                  )}
                </div>

                <div className="space-y-1">
                  <span className="text-xs text-muted font-medium">Verification</span>
                  <p className="font-mono text-xs break-all">
                    {savedVerify || readiness?.verifyCommand || 'None configured'}
                  </p>
                  {!savedVerify && readiness?.verifyCommand && (
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
                      Use suggested check
                    </Button>
                  )}
                </div>

                <div className="space-y-1">
                  <span className="text-xs text-muted font-medium">Preview</span>
                  <p className="font-mono text-xs break-all">
                    {savedPreview || readiness?.previewCommand || 'None configured'}
                  </p>
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
                      Use suggested preview
                    </Button>
                  )}
                </div>
              </div>

              {savedNotice && <p className="text-xs text-accent font-medium">{savedNotice}</p>}

              {!!readiness?.changes && (
                <Disclosure className="pt-2 border-t border-[var(--color-border-subtle)]">
                  <DisclosureSummary>View uncommitted local changes</DisclosureSummary>
                  <pre className="task-input whitespace-pre-wrap break-words mt-2 max-h-48 overflow-y-auto text-xs">
                    {readiness.changes}
                  </pre>
                </Disclosure>
              )}

              <div className="pt-3 flex justify-between items-center border-t border-[var(--color-border-subtle)]">
                <span className="text-xs text-muted">
                  Configure runners, model routing, and verification options.
                </span>
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
                      <p className="font-medium text-sm break-words">{taskTitle(run.prompt)}</p>
                      <p className="task-muted text-xs">
                        Integrated locally · {new Date(run.startedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => useWorkViewStore.getState().open(run.id, 'delivery')}
                    >
                      View delivery
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
