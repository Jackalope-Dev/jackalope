import {
  Cloud,
  Cpu,
  Database,
  FolderCog,
  Gavel,
  History,
  LifeBuoy,
  type LucideIcon,
  Monitor,
  Palette,
  Plug,
  Radio,
  Server,
  Settings2,
  Shield,
  UserRound,
  Zap,
} from 'lucide-react';

/** Sidebar sections, in order. Advanced holds routing and diagnostics most people never change. */
export const SETTINGS_GROUPS = [
  'Workspace',
  'Connections',
  'Account & access',
  'Help & data',
  'Advanced',
] as const;

interface CategoryEntry {
  id: string;
  group: (typeof SETTINGS_GROUPS)[number];
  /** Search words besides the category name. */
  keywords: string;
  /** Listed in the sidebar with this icon; a category without one shows inside `within`. */
  icon?: LucideIcon;
  /** The sidebar category whose page shows this one as a section. */
  within?: string;
  /** Offered when settings are scoped to one project. */
  project?: boolean;
  /** Offered app-wide. */
  app?: false;
}

/** Every settings category, in sidebar order within its group. */
export const SETTINGS_CATEGORIES = [
  {
    id: 'Project',
    group: 'Workspace',
    icon: FolderCog,
    project: true,
    app: false,
    keywords: 'repository name path agent instructions verification command',
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
    id: 'Desktop',
    group: 'Workspace',
    icon: Monitor,
    keywords:
      'keyboard shortcuts zoom terminal shell font editor keep awake sleep power WSL links running services previews ports disk worktrees',
  },
  {
    id: 'Saved actions',
    group: 'Workspace',
    icon: Zap,
    keywords: 'prompt presets commands shortcuts reuse global project',
  },
  {
    id: 'Connected work',
    group: 'Connections',
    icon: Plug,
    keywords: 'GitHub Linear Jira issues pull requests API token',
  },
  {
    id: 'Computers',
    group: 'Connections',
    icon: Server,
    keywords: 'bot computer sandbox Docker Colima cloud machine VM remote desktop VNC hosted',
  },
  {
    id: 'Cloudflare',
    group: 'Connections',
    icon: Cloud,
    keywords: 'Cloudflare Artifacts repository hosted cloud swarm worker forks beta',
  },
  {
    id: 'Jackalope account',
    group: 'Account & access',
    icon: UserRound,
    keywords: 'connect sign in email membership account invitations disconnect device',
  },
  {
    id: 'Invitations',
    group: 'Account & access',
    within: 'Jackalope account',
    keywords: 'invite referral share link email accepted connected',
  },
  {
    id: 'Remote access',
    group: 'Account & access',
    icon: Radio,
    keywords: 'hosts phone companion SSH pairing Tailscale device',
  },
  {
    id: 'Privacy',
    group: 'Account & access',
    icon: Shield,
    keywords: 'marketplace MCP network telemetry crash reporting',
  },
  {
    id: 'Updates & support',
    group: 'Help & data',
    icon: LifeBuoy,
    keywords:
      'version automatic install release notes help feedback diagnostics report community discord',
  },
  {
    id: 'Data & reset',
    group: 'Help & data',
    icon: Database,
    keywords: 'export clipboard erase delete nuke reset first time setup history local data',
  },
  {
    id: 'Decisions',
    group: 'Advanced',
    icon: Gavel,
    project: true,
    keywords: 'Jackalope routing Jev TypeSafe API key automatic agent cost tokens capacity',
  },
  {
    id: 'Diagnostics',
    group: 'Advanced',
    icon: History,
    keywords: 'activity log routing events errors codebase',
  },
  {
    id: 'System',
    group: 'Advanced',
    icon: Cpu,
    keywords: 'device computer operating system architecture git',
  },
] as const satisfies readonly CategoryEntry[];

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]['id'];
/** Categories a project's settings offer. */
export type ProjectSettingsCategory = Extract<
  (typeof SETTINGS_CATEGORIES)[number],
  { project: true }
>['id'];
/** Categories the app-wide settings offer. */
export type AppSettingsCategory = Exclude<
  SettingsCategory,
  Extract<(typeof SETTINGS_CATEGORIES)[number], { app: false }>['id']
>;

export function settingsCategory(id: SettingsCategory): CategoryEntry {
  return SETTINGS_CATEGORIES.find((entry) => entry.id === id) as CategoryEntry;
}

/** The sidebar category that shows `id`: its own, or the one it sits within. */
export function sidebarCategory(id: SettingsCategory): SettingsCategory {
  return (settingsCategory(id).within as SettingsCategory | undefined) ?? id;
}
