import {
  Blocks,
  BookOpen,
  Bot,
  BotMessageSquare,
  CalendarClock,
  ChartNoAxesColumn,
  ClipboardList,
  Cloud,
  FileCheck2,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  History,
  ListTodo,
  type LucideIcon,
  Network,
  Plug,
  Settings2,
  Share2,
} from 'lucide-react';
import { openExternalUrl } from '../../lib/native/env';
import type { Feature } from '../../lib/telemetry';
export type ViewGroup = 'tasks' | 'bots' | 'hosts' | 'project' | 'agents' | 'settings';

/**
 * Every workspace view. Shell renders each page from workspace-views.tsx, records the
 * view's telemetry feature and builds group subnavigation from these entries; command
 * search lists them by label, description and keywords.
 */
interface ViewEntry {
  id: string;
  label: string;
  /** The label in its group's subnavigation and the project menu. */
  shortLabel?: string;
  description: string;
  icon: LucideIcon;
  group: ViewGroup;
  /** Listed in the sidebar's top navigation. */
  primary?: boolean;
  feature: Feature;
  keywords?: string;
  /** A search entry for a Settings category rather than a page of its own. */
  settings?: 'Diagnostics' | 'System';
  /** A page reached from another view, whose subnavigation item stays highlighted. */
  within?: string;
  /** Left out of subnavigation and the project menu unless open (or Swarm is connected). */
  listed?: 'when-open' | 'when-swarm';
}

export const WORKSPACE_VIEWS = [
  {
    id: 'kanban',
    label: 'Work',
    shortLabel: 'Tasks',
    description: 'Tasks: plan, review and archive work.',
    icon: ListTodo,
    group: 'tasks',
    primary: true,
    feature: 'tasks',
  },
  {
    id: 'bots',
    label: 'Bots',
    description: 'Saved agents with their own role, model, apps and routines.',
    icon: BotMessageSquare,
    group: 'bots',
    primary: true,
    feature: 'agents',
  },
  {
    id: 'schedules',
    label: 'Schedules',
    description: 'Bots: recurring tasks and their run history.',
    icon: CalendarClock,
    group: 'bots',
    feature: 'schedules',
  },
  {
    id: 'remote-hosts',
    label: 'Hosts',
    description: 'Connect to trusted hosts and continue work from another device.',
    icon: Network,
    group: 'hosts',
    feature: 'connections',
  },
  {
    id: 'project-overview',
    label: 'Project',
    shortLabel: 'Overview',
    description: 'Resume work, prepare your project and deliver results.',
    icon: Network,
    group: 'project',
    feature: 'project',
  },
  {
    id: 'changes',
    label: 'Changes',
    description: 'Project: review uncommitted work and commit it.',
    icon: GitCommitHorizontal,
    group: 'project',
    feature: 'project',
  },
  {
    id: 'worktrees',
    label: 'Worktrees',
    description: 'Project: inspect and clean up branches.',
    icon: GitBranch,
    group: 'project',
    feature: 'worktrees',
  },
  {
    id: 'topology',
    label: 'Codebase',
    description: 'Explore codebase dependencies and project worktrees.',
    icon: Network,
    group: 'project',
    feature: 'codebase',
  },
  {
    id: 'project-knowledge',
    label: 'Context',
    description: 'Project: repository context, saved lessons and workflows.',
    icon: BookOpen,
    group: 'project',
    feature: 'knowledge',
  },
  {
    id: 'repo-todos',
    label: 'Repo TODOs',
    shortLabel: 'TODOs',
    description: 'Project: view, edit and create repository TODOs and roadmaps.',
    icon: ListTodo,
    group: 'project',
    feature: 'project',
  },
  {
    id: 'plans',
    label: 'Plans',
    description: 'Project: plans to review, approve and follow while they run.',
    icon: ClipboardList,
    group: 'project',
    feature: 'tasks',
  },
  {
    id: 'swarm',
    label: 'Swarm',
    description: 'Project: every agent fork on Artifacts and the conflicts between them.',
    icon: GitFork,
    group: 'project',
    feature: 'project',
    listed: 'when-swarm',
  },
  {
    id: 'cloud-resources',
    label: 'Cloud resources',
    description: 'Project: Cloudflare storage, databases and queues for this project.',
    icon: Cloud,
    group: 'project',
    feature: 'settings',
    listed: 'when-open',
  },
  {
    id: 'project-settings',
    label: 'Project settings',
    shortLabel: 'Settings',
    description: 'Repository preferences, instructions and verification.',
    icon: Settings2,
    group: 'project',
    feature: 'settings',
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Agents, accounts, tools and usage.',
    icon: Bot,
    group: 'agents',
    primary: true,
    feature: 'agents',
  },
  {
    id: 'mcps',
    label: 'Tools',
    description: 'Install and configure MCP tools.',
    icon: Plug,
    group: 'agents',
    feature: 'connections',
  },
  {
    id: 'mcp-marketplace',
    label: 'Tool marketplace',
    description: 'MCP: discover and install tools and services.',
    icon: Plug,
    group: 'agents',
    feature: 'connections',
    within: 'mcps',
  },
  {
    id: 'connected-apps',
    label: 'Connected apps',
    shortLabel: 'Apps',
    description: 'Agents: sign in to apps once through Composio for every agent.',
    icon: Blocks,
    group: 'agents',
    feature: 'connections',
  },
  {
    id: 'usage',
    label: 'Usage & quota',
    shortLabel: 'Usage',
    description: 'Agents: account limits and recorded token usage.',
    icon: ChartNoAxesColumn,
    group: 'agents',
    feature: 'usage',
  },
  {
    id: 'browser',
    label: 'Evidence',
    description: 'Tasks: screenshots and check results.',
    icon: FileCheck2,
    group: 'tasks',
    feature: 'browser',
  },
  {
    id: 'agent-settings',
    label: 'Agent configuration',
    description: 'Agents: accounts, models, paths and defaults.',
    icon: Settings2,
    group: 'agents',
    feature: 'agents',
    within: 'agents',
  },
  {
    id: 'audit',
    label: 'Diagnostics',
    description: 'Settings: activity log, routing and discovery events.',
    icon: History,
    group: 'settings',
    feature: 'settings',
    settings: 'Diagnostics',
  },
  {
    id: 'mesh',
    label: 'System',
    description: 'Settings: this computer and device information.',
    icon: Share2,
    group: 'settings',
    feature: 'settings',
    settings: 'System',
  },
  {
    id: 'preferences',
    label: 'Settings',
    description: 'App preferences, appearance, privacy and support.',
    icon: Settings2,
    group: 'settings',
    feature: 'settings',
  },
] as const satisfies readonly ViewEntry[];
export type ActiveTab = (typeof WORKSPACE_VIEWS)[number]['id'];
/** Views with a page of their own; the others open a Settings category. */
export type PageTab = Exclude<
  ActiveTab,
  Extract<(typeof WORKSPACE_VIEWS)[number], { settings: string }>['id']
>;
export const DEFAULT_WORKSPACE_TAB: ActiveTab = 'kanban';

export function workspaceView(id: ActiveTab): ViewEntry {
  return WORKSPACE_VIEWS.find((item) => item.id === id) ?? WORKSPACE_VIEWS[0];
}

/** The label a view shows in its group's subnavigation. */
export function viewLabel(id: ActiveTab) {
  const view = workspaceView(id);
  return view.shortLabel ?? view.label;
}

/** The subnavigation item that stays highlighted while `id` is open. */
export function highlightedView(id: ActiveTab) {
  return (workspaceView(id).within as ActiveTab | undefined) ?? id;
}

export const PRIMARY_VIEWS = WORKSPACE_VIEWS.filter((item) => 'primary' in item && item.primary);

/** The views a group's subnavigation and the project menu list. */
export function groupViews(group: ViewGroup, open?: ActiveTab, swarmConnected = false) {
  return WORKSPACE_VIEWS.filter((item: ViewEntry) => {
    if (item.group !== group || item.within || item.settings) return false;
    if (item.listed === 'when-open') return item.id === open;
    if (item.listed === 'when-swarm') return swarmConnected || item.id === open;
    return true;
  });
}

export function navigateWorkspace(tab: ActiveTab) {
  window.dispatchEvent(new CustomEvent('jackalope:navigate', { detail: tab }));
}
export function openSettings(
  category:
    | 'Agents'
    | 'General'
    | 'System'
    | 'Diagnostics'
    | 'Invitations'
    | 'Updates & support'
    | 'Connected work'
    | 'Cloudflare',
) {
  window.dispatchEvent(new CustomEvent('jackalope:open-settings', { detail: category }));
}

export interface ProjectSettingsDestination {
  projectId: string;
  category: 'Project' | 'Appearance' | 'Agents';
}

export function openProjectSettings(
  projectId: string,
  category: ProjectSettingsDestination['category'] = 'Project',
) {
  window.dispatchEvent(
    new CustomEvent<ProjectSettingsDestination>('jackalope:open-settings', {
      detail: { projectId, category },
    }),
  );
}

/** Opens a project's Cloud resources screen. */
export function openCloudResources(projectId: string) {
  window.dispatchEvent(new CustomEvent('jackalope:open-cloud-resources', { detail: projectId }));
}

/** Opens the composer on a draft another surface prepared under `key`. */
export function openHelperDraft(key: string) {
  window.dispatchEvent(new CustomEvent('jackalope:helper-draft', { detail: key }));
}

export function openAgentConfiguration(agentId: string) {
  window.dispatchEvent(new CustomEvent('jackalope:configure-agent', { detail: agentId }));
}

export const OPEN_SHORTCUTS_EVENT = 'jackalope:open-shortcuts';

export function openShortcuts() {
  window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));
}

const HELP_URL = 'https://jackalope.dev/knowledge/';

export function openHelp() {
  return openExternalUrl(HELP_URL);
}
