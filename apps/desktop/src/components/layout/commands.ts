import {
  Keyboard,
  LifeBuoy,
  type LucideIcon,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  SquareTerminal,
} from 'lucide-react';
import { openShortcuts } from '../../lib/app-events';
import { openCliTerminal } from '../../lib/cli-terminal';
import { openHelp } from '../../lib/navigation';
import type { ShortcutAction } from '../../lib/shortcuts';
import type { Project } from '../../stores/projectStore';

/** What commands act on; Shell provides it. */
export interface CommandContext {
  focusComposer: () => void;
  setSearchOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  openSettings: () => void;
  /** Settings, or back to the previous view when Settings is already open. */
  toggleSettings: () => void;
  toggleSidebar: () => void;
  /** The project a local terminal opens in: the focused one, unless working on a remote host. */
  terminalProject?: Project;
}

export interface Command {
  id: ShortcutAction | 'shortcuts' | 'help';
  /** The label in command search. */
  label: (ctx: CommandContext) => string;
  icon: LucideIcon;
  keywords: string;
  /** The configurable keyboard shortcut that runs it. */
  shortcut?: ShortcutAction;
  /** A fixed key shown beside it. */
  key?: string;
  /** Left out of command search (the search itself, sidebar layout). */
  hidden?: boolean;
  available?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
  /** What the keyboard shortcut does when it differs from `run`. */
  onShortcut?: (ctx: CommandContext) => void;
}

/** Commands shared by keyboard shortcuts, the tray and window menus, command search and the shortcut sheet. */
export const COMMANDS: readonly Command[] = [
  {
    id: 'search',
    label: () => 'Search and commands',
    icon: Search,
    keywords: '',
    shortcut: 'search',
    hidden: true,
    run: (ctx) => ctx.setSearchOpen(true),
    onShortcut: (ctx) => ctx.setSearchOpen((open) => !open),
  },
  {
    id: 'newWork',
    label: () => 'New work',
    icon: Plus,
    keywords: 'work task conversation capture idea',
    shortcut: 'newWork',
    run: (ctx) => ctx.focusComposer(),
  },
  {
    id: 'terminal',
    label: (ctx) => `Open terminal in ${ctx.terminalProject?.name ?? 'project'}`,
    icon: SquareTerminal,
    keywords: 'terminal cli command shell console jackalope',
    shortcut: 'terminal',
    available: (ctx) => Boolean(ctx.terminalProject),
    run: async (ctx) => {
      if (ctx.terminalProject) await openCliTerminal(ctx.terminalProject.path);
    },
  },
  {
    id: 'settings',
    label: () => 'Settings & Preferences',
    icon: Settings2,
    keywords: 'settings preferences options configuration project',
    shortcut: 'settings',
    run: (ctx) => ctx.openSettings(),
    onShortcut: (ctx) => ctx.toggleSettings(),
  },
  {
    id: 'sidebar',
    label: () => 'Collapse or expand sidebar',
    icon: PanelLeftClose,
    keywords: '',
    shortcut: 'sidebar',
    hidden: true,
    run: (ctx) => ctx.toggleSidebar(),
  },
  {
    id: 'shortcuts',
    label: () => 'Keyboard shortcuts',
    icon: Keyboard,
    keywords: 'keyboard shortcuts keys hotkeys',
    key: '?',
    run: () => {
      requestAnimationFrame(openShortcuts);
    },
  },
  {
    id: 'help',
    label: () => 'Help & Knowledgebase',
    icon: LifeBuoy,
    keywords: 'help docs documentation knowledgebase faq troubleshooting guides',
    run: () => openHelp(),
  },
];

export function findCommand(id: string) {
  return COMMANDS.find((command) => command.id === id);
}

/** Commands search offers for `query` (lowercase); everything when it is empty. */
export function matchingCommands(ctx: CommandContext, query: string) {
  return COMMANDS.filter(
    (command) =>
      !command.hidden &&
      (command.available?.(ctx) ?? true) &&
      `${command.label(ctx)} ${command.keywords}`.toLowerCase().includes(query),
  );
}
