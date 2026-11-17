import {
  Blocks,
  Bot,
  Cloud,
  Cpu,
  Database,
  FolderCog,
  GitFork,
  History,
  Keyboard,
  LifeBuoy,
  type LucideIcon,
  Monitor,
  MonitorSmartphone,
  Palette,
  Plug,
  Route,
  Server,
  Settings2,
  Shield,
  Ticket,
  UserRound,
  Wrench,
} from 'lucide-react';

/** Pages an app-wide settings entry can open; each must be a workspace view id. */
type SettingsPageId =
  | 'agents'
  | 'routing'
  | 'mcps'
  | 'connected-apps'
  | 'remote-hosts'
  | 'project-knowledge'
  | 'project-settings';

/** Sidebar sections, in order. Troubleshooting holds pages most people never need. */
export const SETTINGS_GROUPS = [
  'Workspace',
  'Agents',
  'Integrations',
  'Where agents run',
  'Account & devices',
  'Help',
  'Troubleshooting',
] as const;

interface CategoryEntry {
  id: string;
  group: (typeof SETTINGS_GROUPS)[number];
  /** Search words besides the category name, including names it had before it moved. */
  keywords: string;
  /** Listed in the sidebar with this icon; a category without one shows inside `within`. */
  icon?: LucideIcon;
  /** The sidebar category whose page shows this one as a section. */
  within?: string;
  /** A project link (openProjectSettings) can open it: the project's settings page, its
      appearance override or its routing override. */
  project?: boolean;
  /** The entry opens this page instead of a settings section. */
  page?: SettingsPageId;
  /** For a page entry: the one line shown where search lists it. */
  summary?: string;
  /** Found by search only, for features that moved out of Settings. */
  hidden?: true;
}

/** Every settings category, in sidebar order within its group. */
export const SETTINGS_CATEGORIES = [
  {
    id: 'Project',
    group: 'Workspace',
    icon: FolderCog,
    project: true,
    page: 'project-settings',
    hidden: true,
    summary: "Each project's settings are on its page: open a project, then Settings.",
    keywords:
      'project settings per project repository name path agent instructions verification command',
  },
  {
    id: 'General',
    group: 'Workspace',
    icon: Settings2,
    keywords:
      'window close exit system tray background quit minimize launch login startup guided setup onboarding notifications system quiet test',
  },
  {
    id: 'Appearance',
    group: 'Workspace',
    icon: Palette,
    project: true,
    keywords: 'theme color light dark atmosphere picker toolbar companion mascot animations',
  },
  {
    id: 'Editor & terminal',
    group: 'Workspace',
    icon: Monitor,
    keywords:
      'desktop zoom terminal shell font editor keep awake sleep power WSL links running services previews ports disk worktrees dictation transcription voice command line cli',
  },
  {
    id: 'Keyboard shortcuts',
    group: 'Workspace',
    icon: Keyboard,
    keywords: 'shortcuts hotkeys keybindings key bindings keys desktop',
  },
  {
    id: 'Workflows',
    group: 'Workspace',
    page: 'project-knowledge',
    hidden: true,
    summary:
      "Reusable prompts are workflows in each project's Context, and commands are in Project settings.",
    keywords: 'saved actions prompt presets prompts commands reusable workflows',
  },
  {
    id: 'Agents & accounts',
    group: 'Agents',
    icon: Bot,
    page: 'agents',
    summary: 'Installed agents, their accounts and models, providers, local models and defaults.',
    keywords:
      'agent accounts sign in models providers API key local models Ollama defaults install',
  },
  {
    id: 'Routing',
    group: 'Agents',
    icon: Route,
    project: true,
    page: 'routing',
    summary: 'How Jackalope picks an agent and model for each task.',
    keywords:
      'decisions Jackalope routing Jev TypeSafe API key automatic agent model cost tokens capacity',
  },
  {
    id: 'Connected work',
    group: 'Integrations',
    icon: Plug,
    keywords: 'GitHub Linear Jira issues pull requests API token connections',
  },
  {
    id: 'Tools',
    group: 'Integrations',
    icon: Wrench,
    page: 'mcps',
    summary: 'MCP tools agents can use, and the tool marketplace.',
    keywords: 'MCP servers tools marketplace allmcps connections',
  },
  {
    id: 'Connected apps',
    group: 'Integrations',
    icon: Blocks,
    page: 'connected-apps',
    summary: 'Sign in to apps once through Composio for every agent.',
    keywords: 'Composio apps sign in connections',
  },
  {
    id: 'Cloudflare',
    group: 'Integrations',
    icon: Cloud,
    keywords: 'Cloudflare Artifacts repository hosted cloud connections',
  },
  {
    id: 'Computers',
    group: 'Where agents run',
    icon: Server,
    keywords:
      'bot computer sandbox Docker Colima cloud machine VM remote desktop VNC hosted connections',
  },
  {
    id: 'Swarm',
    group: 'Where agents run',
    icon: GitFork,
    keywords: 'swarm worker forks Cloudflare beta connections',
  },
  {
    id: 'Jackalope account',
    group: 'Account & devices',
    icon: UserRound,
    keywords: 'connect sign in email membership account disconnect device',
  },
  {
    id: 'Invitations',
    group: 'Account & devices',
    icon: Ticket,
    keywords: 'invite referral trial passes share link email accepted connected',
  },
  {
    id: 'Devices',
    group: 'Account & devices',
    icon: MonitorSmartphone,
    page: 'remote-hosts',
    summary: 'Use other computers from here, or let a phone or another computer use this one.',
    keywords: 'remote access hosts phone companion SSH pairing pair Tailscale device',
  },
  {
    id: 'Privacy',
    group: 'Account & devices',
    icon: Shield,
    keywords:
      'network telemetry crash reporting settings sync Claude Code Codex terminal conversations sessions outside',
  },
  {
    id: 'Help & community',
    group: 'Help',
    icon: LifeBuoy,
    keywords:
      'updates support version automatic install release notes help feedback report community discord knowledgebase documentation',
  },
  {
    id: 'Diagnostics',
    group: 'Troubleshooting',
    icon: History,
    keywords: 'activity log routing events errors codebase advanced',
  },
  {
    id: 'System',
    group: 'Troubleshooting',
    icon: Cpu,
    keywords: 'device computer operating system architecture git advanced',
  },
  {
    id: 'Data & reset',
    group: 'Troubleshooting',
    icon: Database,
    keywords: 'export clipboard erase delete nuke reset first time setup history local data',
  },
] as const satisfies readonly CategoryEntry[];

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]['id'];
/** Categories a project link can open (see `project` on an entry). */
export type ProjectSettingsCategory = Extract<
  (typeof SETTINGS_CATEGORIES)[number],
  { project: true }
>['id'];
/** Settings are app-wide only; project settings live on each project's page. */
export type AppSettingsCategory = SettingsCategory;

export function settingsCategory(id: SettingsCategory): CategoryEntry {
  return SETTINGS_CATEGORIES.find((entry) => entry.id === id) as CategoryEntry;
}

/** The sidebar category that shows `id`: its own, or the one it sits within. */
export function sidebarCategory(id: SettingsCategory): SettingsCategory {
  return (settingsCategory(id).within as SettingsCategory | undefined) ?? id;
}
