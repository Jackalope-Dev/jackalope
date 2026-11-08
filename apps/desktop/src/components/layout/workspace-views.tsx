import { lazy, type ReactNode } from 'react';
import type { ActiveTab, PageTab } from '../../lib/navigation';
import type { SettingsCategory } from '../../lib/settings-categories';
import { openRun, selectWork } from '../../lib/work-selection';
import type { Project } from '../../stores/projectStore';
import type { ComposerSeed } from '../sessions/SessionStart';
import { TaskWorkspace } from '../tasks/TaskWorkspace';
import { WorkspacePage } from '../ui/WorkspacePage';

/** What Shell hands every page: the focused project and the cross-page actions. */
export interface ViewContext {
  activeProjectId: string | null;
  project?: Project;
  open: (tab: ActiveTab) => void;
  openProjectSetup: () => void;
  openInComposer: (seed: { ideaId?: string; agent?: string; draftKey?: string }) => void;
  focusComposer: () => void;
  composer: {
    focus: number;
    seed: ComposerSeed | null;
    onSeedApplied: (seed: ComposerSeed) => void;
  };
  schedule: { runId?: string; open: (runId: string) => void; handled: () => void };
  settings: {
    category: SettingsCategory;
    projectId?: string;
    open: (category: SettingsCategory) => void;
    close: () => void;
  };
  configuredAgent?: string;
}

// Pages load on demand so the first paint ships only the task workspace.
const RepoTodos = lazy(() => import('../tasks/RepoTodos').then((m) => ({ default: m.RepoTodos })));
const RemoteHosts = lazy(() =>
  import('../remote/RemoteHosts').then((m) => ({ default: m.RemoteHosts })),
);
const CodebaseMap = lazy(() =>
  import('../visualizer/CodebaseMap').then((m) => ({ default: m.CodebaseMap })),
);
const ProjectOverview = lazy(() =>
  import('../projects/ProjectOverview').then((m) => ({ default: m.ProjectOverview })),
);
const ScheduleManager = lazy(() =>
  import('../schedules/ScheduleManager').then((m) => ({ default: m.ScheduleManager })),
);
const BrowserHarness = lazy(() =>
  import('../browser/BrowserHarness').then((m) => ({ default: m.BrowserHarness })),
);
const UsageDashboard = lazy(() =>
  import('../tasks/UsageDashboard').then((m) => ({ default: m.UsageDashboard })),
);
const CommitReview = lazy(() =>
  import('../projects/CommitReview').then((m) => ({ default: m.CommitReview })),
);
const WorktreeManager = lazy(() =>
  import('../projects/WorktreeManager').then((m) => ({ default: m.WorktreeManager })),
);
const RunnerConnections = lazy(() =>
  import('../tasks/RunnerConnections').then((m) => ({ default: m.RunnerConnections })),
);
const AgentManager = lazy(() =>
  import('../agents/AgentManager').then((m) => ({ default: m.AgentManager })),
);
const BotsWorkspace = lazy(() =>
  import('../bots/BotsWorkspace').then((m) => ({ default: m.BotsWorkspace })),
);
const SwarmBoard = lazy(() =>
  import('../swarm/SwarmBoard').then((m) => ({ default: m.SwarmBoard })),
);
const CloudResources = lazy(() =>
  import('../projects/CloudResources').then((m) => ({ default: m.CloudResources })),
);
const PlanPage = lazy(() => import('../planning/PlanPage').then((m) => ({ default: m.PlanPage })));
const ConnectedApps = lazy(() =>
  import('../mcp/ConnectedApps').then((m) => ({ default: m.ConnectedApps })),
);
const McpWorkspace = lazy(() =>
  import('../mcp/McpWorkspace').then((m) => ({ default: m.McpWorkspace })),
);
const ProjectContext = lazy(() =>
  import('../projects/ProjectContext').then((m) => ({ default: m.ProjectContext })),
);
const ProjectPreferences = lazy(() =>
  import('../projects/ProjectPreferences').then((m) => ({ default: m.ProjectPreferences })),
);
const SettingsPage = lazy(() =>
  import('../settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

function openTask(ctx: ViewContext, runId: string) {
  openRun(runId);
  ctx.open('kanban');
}

function mcpWorkspace(ctx: ViewContext, view: 'configured' | 'marketplace') {
  return (
    <McpWorkspace
      view={view}
      onViewChange={(next) => ctx.open(next === 'configured' ? 'mcps' : 'mcp-marketplace')}
    />
  );
}

/** The page each view renders. A view without an entry here does not type-check. */
export const VIEW_PAGES: Record<PageTab, (ctx: ViewContext) => ReactNode> = {
  kanban: (ctx) => (
    <TaskWorkspace
      composerFocus={ctx.composer.focus}
      composerSeed={ctx.composer.seed}
      onComposerSeedApplied={ctx.composer.onSeedApplied}
      onCapture={(ideaId) => (ideaId ? ctx.openInComposer({ ideaId }) : ctx.focusComposer())}
      onSchedule={ctx.schedule.open}
    />
  ),
  bots: () => <BotsWorkspace />,
  schedules: (ctx) => (
    <ScheduleManager
      key={ctx.activeProjectId}
      sourceRunId={ctx.schedule.runId}
      onSourceHandled={ctx.schedule.handled}
      onOpenProject={ctx.openProjectSetup}
      onPlanning={() => {
        selectWork();
        ctx.open('kanban');
      }}
    />
  ),
  'remote-hosts': (ctx) => <RemoteHosts onSetup={() => ctx.settings.open('Remote access')} />,
  'project-overview': (ctx) => <ProjectOverview onOpenProject={ctx.openProjectSetup} />,
  changes: (ctx) => <CommitReview key={ctx.activeProjectId} onOpenProject={ctx.openProjectSetup} />,
  worktrees: (ctx) => (
    <WorktreeManager key={ctx.activeProjectId} onOpenProject={ctx.openProjectSetup} />
  ),
  topology: (ctx) => <CodebaseMap onOpenProject={ctx.openProjectSetup} />,
  'project-knowledge': (ctx) => <ProjectContext key={ctx.activeProjectId} />,
  'repo-todos': (ctx) => (
    <RepoTodos
      key={ctx.project?.path ?? ctx.activeProjectId}
      onCapture={(draftKey) => ctx.openInComposer({ draftKey })}
      onOpenProject={ctx.openProjectSetup}
    />
  ),
  plans: (ctx) => <PlanPage key={ctx.activeProjectId} />,
  swarm: () => <SwarmBoard />,
  'cloud-resources': (ctx) => <CloudResources key={ctx.activeProjectId} />,
  'project-settings': (ctx) => <ProjectPreferences key={ctx.activeProjectId} />,
  agents: (ctx) => (
    <RunnerConnections
      onNewTask={(agent) => ctx.openInComposer({ agent })}
      onRun={(run) => openTask(ctx, run.id)}
    />
  ),
  mcps: (ctx) => mcpWorkspace(ctx, 'configured'),
  'mcp-marketplace': (ctx) => mcpWorkspace(ctx, 'marketplace'),
  'connected-apps': () => <ConnectedApps />,
  usage: (ctx) => <UsageDashboard onTask={() => ctx.open('kanban')} />,
  browser: (ctx) => (
    <BrowserHarness onOpenProject={ctx.openProjectSetup} onTask={(id) => openTask(ctx, id)} />
  ),
  'agent-settings': (ctx) => (
    <WorkspacePage className="agent-settings-page">
      <AgentManager key={ctx.configuredAgent} initialAgentId={ctx.configuredAgent} />
    </WorkspacePage>
  ),
  preferences: (ctx) => (
    <SettingsPage
      key={`${ctx.settings.category}:${ctx.settings.projectId ?? 'app'}`}
      initialCategory={ctx.settings.category}
      initialScope={ctx.settings.projectId ? 'project' : 'app'}
      initialProjectId={ctx.settings.projectId}
      onClose={ctx.settings.close}
    />
  ),
};
