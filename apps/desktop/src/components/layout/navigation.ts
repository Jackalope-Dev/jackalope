import {
  BookOpen,
  Bot,
  CalendarClock,
  ChartNoAxesColumn,
  FileCheck2,
  GitBranch,
  History,
  Layers3,
  ListTodo,
  Network,
  Plug,
  Radio,
  Settings2,
  Share2,
} from 'lucide-react';
export const WORKSPACE_VIEWS = [
  {
    id: 'kanban',
    label: 'Tasks',
    description: 'Plan, execute and review work.',
    icon: Layers3,
    group: 'tasks',
    primary: true,
  },
  {
    id: 'live-sessions',
    label: 'Live',
    description: 'Live sessions: send ideas, follow work and review changes.',
    icon: Radio,
    group: 'live',
    primary: true,
  },
  {
    id: 'topology',
    label: 'Project',
    description: 'Explore codebase dependencies and project worktrees.',
    icon: Network,
    group: 'project',
    primary: true,
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Manage runners, accounts and configuration.',
    icon: Bot,
    group: 'agents',
    primary: true,
  },
  {
    id: 'mcps',
    label: 'MCP',
    description: 'Install and configure MCP tools.',
    icon: Plug,
    group: 'connections',
    primary: true,
  },
  {
    id: 'mcp-marketplace',
    label: 'Marketplace',
    description: 'MCP: discover and install tools and services.',
    icon: Plug,
    group: 'connections',
    primary: false,
  },
  {
    id: 'usage',
    label: 'Usage',
    description: 'Understand consumption and account capacity.',
    icon: ChartNoAxesColumn,
    group: 'usage',
    primary: true,
  },
  {
    id: 'repo-todos',
    label: 'Repo TODOs',
    description: 'Project: view, edit and create repository TODOs and roadmaps.',
    icon: ListTodo,
    group: 'project',
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
    id: 'schedules',
    label: 'Recurring',
    description: 'Tasks: schedules and automatic runs.',
    icon: CalendarClock,
    group: 'tasks',
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
    id: 'project-knowledge',
    label: 'Context',
    description: 'Project: repository context, saved lessons and workflows.',
    icon: BookOpen,
    group: 'project',
    primary: false,
  },
  {
    id: 'project-settings',
    label: 'Project settings',
    description: 'Repository preferences, instructions and verification.',
    icon: Settings2,
    group: 'project',
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
export const USAGE_VIEWS = [
  { id: 'tokens', label: 'Tokens & usage' },
  { id: 'analytics', label: 'Performance & insights' },
] as const;
export type UsageView = (typeof USAGE_VIEWS)[number]['id'];
export function navigateWorkspace(tab: ActiveTab) {
  window.dispatchEvent(new CustomEvent('jackalope:navigate', { detail: tab }));
}
export function openSettings(
  category: 'General' | 'System' | 'Diagnostics' | 'Invitations' | 'Updates & support',
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
