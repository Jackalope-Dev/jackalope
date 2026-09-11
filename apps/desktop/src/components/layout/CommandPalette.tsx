import { PRESET_THEMES } from '@jackalope/brand/theme';
import { SearchField } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { Folder, LifeBuoy, MessageSquare, Plus, Settings2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { shortcutLabel } from '../../lib/platform-shortcuts';
import { taskTitle } from '../../lib/task-title';
import { taskDecision } from '../../lib/task-workflow';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { type ActiveTab, WORKSPACE_VIEWS } from './navigation';

export function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onOpenSettings,
  onCapture,
  onSelectProject,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: ActiveTab) => void;
  onOpenSettings?: () => void;
  onCapture?: () => void;
  onSelectProject?: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const previousFocus = useRef<HTMLElement | null>(null);
  const setTheme = useThemeStore((state) => state.setTheme);
  const search = query.trim().toLowerCase();
  const projects = useProjectStore((state) => state.projects);
  const runs = useExecutionStore((state) => state.runs);
  const sessions = useLiveSessionStore((state) => state.sessions);
  const selected = useExecutionStore((state) => state.selectedId);
  const current = runs.find((run) => run.id === selected);
  const latest = useMemo(() => {
    const tasks = new Map<
      string,
      { run: (typeof runs)[number]; original: (typeof runs)[number] }
    >();
    for (const run of runs) {
      if (run.liveSessionId) continue;
      const task = tasks.get(run.taskId);
      if (!task) tasks.set(run.taskId, { run, original: run });
      else {
        if (Date.parse(run.startedAt) > Date.parse(task.run.startedAt)) task.run = run;
        if (Date.parse(run.startedAt) < Date.parse(task.original.startedAt)) task.original = run;
      }
    }
    return [...tasks.values()];
  }, [runs]);
  const work = [
    ...latest.map(({ run, original }) => ({
      id: run.id,
      title: taskTitle(original.prompt),
      project: run.projectName,
      date: run.startedAt,
      state: taskDecision(run).label,
    })),
    ...sessions.map((session) => ({
      id: `session:${session.id}`,
      title: session.title,
      project: session.request.projectName,
      date: session.updatedAt,
      state: 'Live session',
    })),
  ]
    .filter((item) => `${item.title} ${item.project} ${item.state}`.toLowerCase().includes(search))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 8);
  const matchingProjects = projects
    .filter((project) => `${project.name} ${project.path}`.toLowerCase().includes(search))
    .slice(0, 6);
  const actions = current
    ? [
        { label: taskDecision(current).action, section: taskDecision(current).section },
        { label: 'Open conversation', section: 'result' },
        ...(['review', 'reviewed', 'failed', 'stopped'].includes(current.status)
          ? [
              { label: 'Try result', section: 'preview' },
              { label: 'Review changes and checks', section: 'changes' },
              { label: 'Prepare delivery', section: 'delivery' },
            ]
          : []),
      ].filter((action) => action.label.toLowerCase().includes(search))
    : [];
  const showSettings =
    Boolean(onOpenSettings) &&
    ('settings preferences options configuration project'
      .split(' ')
      .some((kw) => kw.includes(search)) ||
      'settings & preferences'.includes(search));
  const showHelp =
    'help docs documentation knowledgebase faq troubleshooting guides'
      .split(' ')
      .some((kw) => kw.includes(search)) || search.includes('help');
  const views = WORKSPACE_VIEWS.filter((item) =>
    `${item.label} ${item.description}`.toLowerCase().includes(search),
  );
  const themes = PRESET_THEMES.filter((item) => item.name.toLowerCase().includes(search));

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-[var(--color-surface-sunken)]/70 backdrop-blur-sm z-[80]" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setQuery('');
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previousFocus.current?.isConnected) previousFocus.current.focus();
          }}
          className="command-dialog fixed top-[18vh] left-1/2 -translate-x-1/2 w-[480px] max-w-[calc(100vw-2rem)] appearance-panel z-[81] p-3"
          onKeyDown={(event) => {
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-command]'),
            );
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const target =
                index < 0
                  ? event.key === 'ArrowDown'
                    ? 0
                    : buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                    buttons.length;
              buttons[target]?.focus();
            }
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
              event.preventDefault();
              buttons[0]?.click();
            }
          }}
        >
          <Dialog.Title className="sr-only">Find work or run a command</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search, then use arrow keys and Enter to choose. Escape closes this dialog.
          </Dialog.Description>
          <div className="command-search">
            <SearchField
              aria-label="Search commands"
              placeholder="Search tasks, projects, and actions…"
              value={query}
              onValueChange={(value) => setQuery(value)}
            />
            <Dialog.Close className="quiet-icon text-xs" aria-label="Close commands">
              Esc
            </Dialog.Close>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {actions.length > 0 && <p className="menu-label">Current task</p>}
            {actions.map((action) => (
              <button
                key={action.label}
                data-command
                type="button"
                className="workspace-menu-item w-full text-left"
                onClick={() => {
                  if (current) useWorkViewStore.getState().open(current.id, action.section);
                  onClose();
                }}
              >
                <MessageSquare size={16} />
                <span>{action.label}</span>
              </button>
            ))}
            {work.length > 0 && (
              <p className="menu-label">{search ? 'Matching work' : 'Recent work'}</p>
            )}
            {work.map((item) => (
              <button
                key={item.id}
                data-command
                type="button"
                className="workspace-menu-item w-full text-left"
                onClick={() => {
                  useWorkViewStore.getState().open(item.id);
                  onClose();
                }}
              >
                <MessageSquare size={16} />
                <span className="min-w-0">
                  <span className="block truncate">{item.title}</span>
                  <small className="block text-[var(--color-text-secondary)]">
                    {item.project} · {item.state}
                  </small>
                </span>
              </button>
            ))}
            {matchingProjects.length > 0 && <p className="menu-label">Projects</p>}
            {matchingProjects.map((project) => (
              <button
                key={project.id}
                data-command
                type="button"
                className="workspace-menu-item w-full text-left"
                onClick={() => {
                  if (onSelectProject) onSelectProject(project.id);
                  else useProjectStore.getState().selectProject(project.id);
                  useWorkViewStore.getState().setScope('project');
                  onNavigate('project-overview');
                  onClose();
                }}
              >
                <Folder size={16} />
                <span>{project.name}</span>
              </button>
            ))}
            <p className="menu-label">Commands</p>
            {onCapture && ('new task capture idea'.includes(search) || !search) && (
              <button
                data-command
                type="button"
                className="workspace-menu-item w-full"
                onClick={() => {
                  onClose();
                  onCapture();
                }}
              >
                <Plus size={16} />
                <span>New task</span>
                <kbd>{shortcutLabel('Shift+N')}</kbd>
              </button>
            )}
            {showSettings && (
              <button
                data-command
                type="button"
                className="workspace-menu-item w-full text-left hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  onOpenSettings?.();
                  onClose();
                }}
              >
                <Settings2 className="size-4 text-[var(--color-accent-ink)]" />
                <span>Settings & Preferences</span>
              </button>
            )}
            {showHelp && (
              <button
                data-command
                type="button"
                className="workspace-menu-item w-full text-left hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  onClose();
                  void openExternalUrl('https://jackalope.dev/knowledge/');
                }}
              >
                <LifeBuoy className="size-4 text-[var(--color-accent-ink)]" />
                <span>Help & Knowledgebase</span>
              </button>
            )}
            {views.map((item) => (
              <button
                data-command
                type="button"
                key={item.id}
                className="workspace-menu-item w-full text-left hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  onNavigate(item.id);
                  onClose();
                }}
              >
                <item.icon className="size-4 text-[var(--color-accent-ink)]" />
                <span>{item.label}</span>
              </button>
            ))}
            {themes.length > 0 && <p className="menu-label">Change atmosphere</p>}
            {themes.map((theme) => (
              <button
                data-command
                type="button"
                key={theme.id}
                className="workspace-menu-item w-full hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  const current = useThemeStore.getState().currentTheme;
                  setTheme({
                    ...theme,
                    isDark: current.isDark,
                    appearance: current.appearance,
                    atmosphere: current.atmosphere,
                    harmony: current.harmony,
                  });
                  onClose();
                }}
              >
                <span className="size-3 rounded-full" style={{ background: theme.accentHex }} />
                <span>{theme.name}</span>
              </button>
            ))}
            {!views.length &&
              !themes.length &&
              !showSettings &&
              !showHelp &&
              !work.length &&
              !matchingProjects.length &&
              !actions.length &&
              !(onCapture && 'new task capture idea'.includes(search)) && (
                <p className="p-6 text-sm text-[var(--color-text-secondary)]">
                  No matches. Try “tasks”, “agents”, or a color.
                </p>
              )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
