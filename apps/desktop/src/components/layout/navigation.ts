import { Bot, CalendarClock, GitBranch, Globe, Layers3, Network, Share2 } from 'lucide-react';

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
    description: 'Follow a session and steer its next step.',
    icon: Bot,
    primary: true,
  },
  {
    id: 'schedules',
    label: 'Schedules',
    description: 'Set work to run on your schedule.',
    icon: CalendarClock,
    primary: false,
  },
  {
    id: 'browser',
    label: 'Browser',
    description: 'Try an interaction in the browser.',
    icon: Globe,
    primary: false,
  },
  {
    id: 'topology',
    label: 'Codebase',
    description: 'Explore how your project fits together.',
    icon: Network,
    primary: false,
  },
  {
    id: 'mesh',
    label: 'Devices',
    description: 'Find your connected workspaces.',
    icon: Share2,
    primary: false,
  },
] as const;

export type ActiveTab = (typeof WORKSPACE_VIEWS)[number]['id'];
