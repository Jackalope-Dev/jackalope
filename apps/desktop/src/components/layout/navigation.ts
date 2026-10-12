import {
  Blocks,
  BookOpen,
  Bot,
  BotMessageSquare,
  CalendarClock,
  ChartNoAxesColumn,
  FileCheck2,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  History,
  Layers3,
  ListTodo,
  Network,
  Plug,
  Settings2,
  Share2,
} from 'lucide-react';
export const WORKSPACE_VIEWS = [
  {
    id: 'live-sessions',
    label: 'Work',
    description: 'Chat: live conversation to send a message, follow work and review changes.',
    icon: Layers3,
    group: 'tasks',
    primary: false,
  },
  {
    id: 'kanban',
    label: 'Work',
    shortLabel: 'Tasks',
    description: 'Tasks: plan, review and archive work.',
    icon: ListTodo,
    group: 'tasks',
    primary: true,
  },
  {
    id: 'bots',
    label: 'Bots',
    description: 'Saved agents with their own role, model, apps and routines.',
    icon: BotMessageSquare,
    group: 'bots',
    primary: true,
  },
  {
    id: 'schedules',
    label: 'Schedules',
    description: 'Bots: recurring tasks and their run history.',
    icon: CalendarClock,
    group: 'bots',
    primary: false,
  },
  {
    id: 'remote-hosts',
    label: 'Hosts',
    description: 'Connect to trusted hosts and continue work from another device.',
    icon: Network,
    group: 'hosts',
    primary: false,
  },
  {
    id: 'project-overview',
    label: 'Project',
    shortLabel: 'Overview',
    description: 'Resume work, prepare your project and deliver results.',
    icon: Network,
    group: 'project',
    primary: true,
  },
  {
    id: 'changes',
    label: 'Changes',
    description: 'Project: review uncommitted work and commit it.',
    icon: GitCommitHorizontal,
    group: 'project',
    primary: false,
  },
  {
    id: 'worktrees',
    label: 'Worktrees',
    description: 'Project: inspect and clean up branches.',
    icon: GitBranch,
    group: 'project',
    primary: false,
  },
  {
    id: 'topology',
    label: 'Codebase',
    description: 'Explore codebase dependencies and project worktrees.',
    icon: Network,
    group: 'project',
    primary: false,
  },
  {
    id: 'project-knowledge',
    label: 'Context',
    description: 'Project: repository context, saved lessons and workflows.',
    icon: BookOpen,
    group: 'project',
    primary: false,
  },
  {
    id: 'repo-todos',
    label: 'Repo TODOs',
    shortLabel: 'TODOs',
    description: 'Project: view, edit and create repository TODOs and roadmaps.',
    icon: ListTodo,
    group: 'project',
    primary: false,
  },
  {
    id: 'swarm',
    label: 'Swarm',
    description: 'Project: every agent fork on Artifacts and the conflicts between them.',
    icon: GitFork,
    group: 'project',
    primary: false,
  },
  {
    id: 'project-settings',
    label: 'Project settings',
    shortLabel: 'Settings',
    description: 'Repository preferences, instructions and verification.',
    icon: Settings2,
    group: 'project',
    primary: false,
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Agents, accounts, tools and usage.',
    icon: Bot,
    group: 'agents',
    primary: true,
  },
  {
    id: 'mcps',
    label: 'Tools',
    description: 'Install and configure MCP tools.',
    icon: Plug,
    group: 'agents',
    primary: false,
  },
  {
    id: 'mcp-marketplace',
    label: 'Tool marketplace',
    description: 'MCP: discover and install tools and services.',
    icon: Plug,
    group: 'agents',
    primary: false,
  },
  {
    id: 'connected-apps',
    label: 'Connected apps',
    shortLabel: 'Apps',
    description: 'Agents: sign in to apps once through Composio for every agent.',
    icon: Blocks,
    group: 'agents',
    primary: false,
  },
  {
    id: 'usage',
    label: 'Usage & quota',
    shortLabel: 'Usage',
    description: 'Agents: account limits and recorded token usage.',
    icon: ChartNoAxesColumn,
    group: 'agents',
    primary: false,
  },
  {
    id: 'browser',
    label: 'Evidence',
    description: 'Tasks: screenshots and check results.',
    icon: FileCheck2,
    group: 'tasks',
    primary: false,
  },
  {
    id: 'agent-settings',
    label: 'Agent configuration',
    description: 'Agents: accounts, models, paths and defaults.',
    icon: Settings2,
    group: 'agents',
    primary: false,
  },
  {
    id: 'audit',
    label: 'Diagnostics',
    description: 'Settings: activity log, routing and discovery events.',
    icon: History,
    group: 'settings',
    primary: false,
  },
  {
    id: 'mesh',
    label: 'System',
    description: 'Settings: this computer and device information.',
    icon: Share2,
    group: 'settings',
    primary: false,
  },
  {
    id: 'preferences',
    label: 'Settings',
    description: 'App preferences, appearance, privacy and support.',
    icon: Settings2,
    group: 'settings',
    primary: false,
  },
] as const;
export type ActiveTab = (typeof WORKSPACE_VIEWS)[number]['id'];
export const DEFAULT_WORKSPACE_TAB: ActiveTab = 'kanban';
/** Agents subnavigation; the tool marketplace opens from Tools and highlights it. */
export const AGENT_VIEWS = [
  { id: 'agents', label: 'Agents' },
  { id: 'mcps', label: 'Tools' },
  { id: 'connected-apps', label: 'Apps' },
  { id: 'usage', label: 'Usage' },
] as const;

/** The label a view shows in its group's subnavigation. */
export function viewLabel(id: ActiveTab) {
  const view: { label: string; shortLabel?: string } | undefined = WORKSPACE_VIEWS.find(
    (item) => item.id === id,
  );
  return view?.shortLabel ?? view?.label ?? id;
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

export function openAgentConfiguration(agentId: string) {
  window.dispatchEvent(new CustomEvent('jackalope:configure-agent', { detail: agentId }));
}
