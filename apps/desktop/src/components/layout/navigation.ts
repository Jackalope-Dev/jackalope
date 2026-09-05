import {
  Bot,
  CalendarClock,
  ChartNoAxesColumn,
  GitBranch,
  Globe,
  History,
  Layers3,
  Network,
  Plug,
  Share2,
} from 'lucide-react';

export const WORKSPACE_VIEWS = [
  {
    id: 'kanban',
    label: 'Tasks',
    description: 'Shape an idea and follow it through.',
    icon: Layers3,
    primary: true,
  },
  {
    id: 'worktrees',
    label: 'Worktrees',
    description: 'Inspect the branches behind your work.',
    icon: GitBranch,
    primary: true,
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Connect installed agents and check sign-in.',
    icon: Bot,
    primary: true,
  },
  {
    id: 'usage',
    label: 'Usage',
    description: 'Understand consumption across your projects.',
    icon: ChartNoAxesColumn,
    primary: true,
  },
  {
    id: 'audit',
    label: 'Audit Log',
    description: 'Inspect routing decisions, failovers, and discovery history.',
    icon: History,
    primary: true,
  },
  {
    id: 'mcps',
    label: 'MCPs',
    description: 'Manage agent MCP servers and browse marketplace.',
    icon: Plug,
    primary: true,
  },
  {
    id: 'board',
    label: 'Planning board',
    description: 'Existing planning records and prototype task details.',
    icon: Layers3,
    primary: false,
  },
  {
    id: 'schedules',
    label: 'Schedules',
    description: 'Preview recurring task plans.',
    icon: CalendarClock,
    primary: false,
  },
  {
    id: 'browser',
    label: 'Browser',
    description: 'Preview browser automation.',
    icon: Globe,
    primary: false,
  },
  {
    id: 'topology',
    label: 'Codebase',
    description: 'Preview project relationships.',
    icon: Network,
    primary: false,
  },
  {
    id: 'mesh',
    label: 'Devices',
    description: 'Preview work across machines.',
    icon: Share2,
    primary: false,
  },
] as const;

export type ActiveTab = (typeof WORKSPACE_VIEWS)[number]['id'];
