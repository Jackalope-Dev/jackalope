import {
  Bot,
  CalendarClock,
  ChartNoAxesColumn,
  FileCheck2,
  GitBranch,
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
    description: 'Plan ideas, follow work on the board, and review results.',
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
    label: 'Activity log',
    description: 'Inspect routing decisions, failovers, and discovery history.',
    icon: History,
    primary: false,
  },
  {
    id: 'mcps',
    label: 'Connections',
    description: 'Connect tools through MCP and choose which agents can use them.',
    icon: Plug,
    primary: true,
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
    label: 'Evidence',
    description: 'Review screenshots and check results saved by tasks.',
    icon: FileCheck2,
    primary: false,
  },
  {
    id: 'topology',
    label: 'Codebase',
    description: 'Repository mapping is not available yet.',
    icon: Network,
    primary: false,
  },
  {
    id: 'mesh',
    label: 'Devices',
    description: 'Inspect this device; pairing is not available yet.',
    icon: Share2,
    primary: false,
  },
] as const;

export type ActiveTab = (typeof WORKSPACE_VIEWS)[number]['id'];
