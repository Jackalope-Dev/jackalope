import { PRESET_THEMES } from '@jackalope/brand/theme';
import { SearchField } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import {
  FileText,
  Folder,
  Keyboard,
  LifeBuoy,
  MessageSquare,
  Paperclip,
  Plus,
  Settings2,
  SquareTerminal,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { openCliTerminal } from '../../lib/cli-terminal';
import { searchFiles } from '../../lib/file-search';
import { ATTACH_TO_COMPOSER, attachmentReference } from '../../lib/prompt-attachments';
import { displayShortcut, resolveShortcuts } from '../../lib/shortcuts';
import { nativeTask } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { taskDecision } from '../../lib/task-workflow';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { type ActiveTab, WORKSPACE_VIEWS } from './navigation';

const fileCache = new Map<string, { files: string[]; loadedAt: number }>();

/** Files in the active project for quick open, refreshed at most every 30 seconds. */
function useProjectFiles(projectPath: string | undefined, enabled: boolean) {
  const [files, setFiles] = useState<string[]>(
    () => (projectPath && fileCache.get(projectPath)?.files) || [],
  );
  useEffect(() => {
    if (!enabled || !projectPath || !isTauriEnvironment()) return;
    const cached = fileCache.get(projectPath);
    if (cached) setFiles(cached.files);
    if (cached && Date.now() - cached.loadedAt < 30_000) return;
    let canceled = false;
    nativeTask<string[]>('project_files_list', { projectPath })
      .then((list) => {
        fileCache.set(projectPath, { files: list, loadedAt: Date.now() });
        if (!canceled) setFiles(list);
      })
      .catch(() => {
        if (!canceled) setFiles([]);
      });
    return () => {
      canceled = true;
    };
  }, [projectPath, enabled]);
  return files;
}

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
  const shortcuts = useSettingsStore((state) => state.shortcuts);
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
      state: session.persona ? `Bot · ${session.persona.name}` : 'Chat',
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
        { label: 'Open task terminal and workspace tools', section: 'terminal' },
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
  const terminalProject = useProjectStore((state) =>
    state.projects.find((item) => item.id === state.activeProjectId),
  );
  const remoteHost = useHostContextStore((state) => state.host);
  const showTerminal =
    Boolean(terminalProject) &&
    !remoteHost &&
    'terminal cli command shell console jackalope'.split(' ').some((kw) => kw.includes(search));
  const showHelp =
    'help docs documentation knowledgebase faq troubleshooting guides'
      .split(' ')
      .some((kw) => kw.includes(search)) || search.includes('help');
  const views = WORKSPACE_VIEWS.filter(
    (item) =>
      item.id !== 'live-sessions' &&
      `${item.label} ${item.description}`.toLowerCase().includes(search),
  );
  const themes = PRESET_THEMES.filter((item) => item.name.toLowerCase().includes(search));
  const preferredEditor = useSettingsStore((state) => state.preferredEditor);
  const projectFiles = useProjectFiles(terminalProject?.path, isOpen && !remoteHost);
  const files = search.length >= 2 ? searchFiles(projectFiles, search, 8) : [];
  const [fileError, setFileError] = useState('');

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
              placeholder="Search work, files, projects and actions…"
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                setFileError('');
              }}
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
            {files.length > 0 && terminalProject && (
              <p className="menu-label">Files in {terminalProject.name}</p>
            )}
            {fileError && (
              <p className="px-3 pb-2 text-xs text-[var(--color-danger)]" role="alert">
                {fileError}
              </p>
            )}
            {terminalProject &&
              files.map((file) => (
                <div key={file} className="command-file-row">
                  <button
                    data-command
                    type="button"
                    className="workspace-menu-item w-full text-left"
                    title={`Open in ${preferredEditor === 'cursor' ? 'Cursor' : 'VS Code'}`}
                    onClick={() => {
                      setFileError('');
                      nativeTask('project_file_open', {
                        projectPath: terminalProject.path,
                        relativePath: file,
                        editor: preferredEditor,
                      })
                        .then(onClose)
                        .catch((cause) => setFileError(String(cause)));
                    }}
                  >
                    <FileText size={16} />
                    <span className="min-w-0">
                      <span className="block truncate">{file.split('/').pop()}</span>
                      <small className="block truncate text-[var(--color-text-secondary)]">
                        {file}
                      </small>
                    </span>
                  </button>
                  {onCapture && (
                    <button
                      type="button"
                      className="quiet-icon command-file-attach"
                      aria-label={`Attach ${file} to new work`}
                      title="Attach to new work"
                      onClick={() => {
                        onClose();
                        onCapture();
                        const reference = attachmentReference(
                          `${terminalProject.path}/${file}`,
                          terminalProject.path,
                        );
                        requestAnimationFrame(() =>
                          window.dispatchEvent(
                            new CustomEvent(ATTACH_TO_COMPOSER, { detail: [reference] }),
                          ),
                        );
                      }}
                    >
                      <Paperclip size={16} />
                    </button>
                  )}
                </div>
              ))}
            <p className="menu-label">Commands</p>
            {onCapture &&
              ('new work task conversation capture idea'.includes(search) || !search) && (
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
                  <span>New work</span>
                  <kbd>{displayShortcut(resolveShortcuts(shortcuts).newWork)}</kbd>
                </button>
              )}
            {showTerminal && terminalProject && (
              <button
                data-command
                type="button"
                className="workspace-menu-item w-full"
                onClick={() => {
                  onClose();
                  void openCliTerminal(terminalProject.path).catch(() => {});
                }}
              >
                <SquareTerminal size={16} />
                <span>Open terminal in {terminalProject.name}</span>
                <kbd>{displayShortcut(resolveShortcuts(shortcuts).terminal)}</kbd>
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
            {'keyboard shortcuts keys hotkeys'.split(' ').some((kw) => kw.includes(search)) && (
              <button
                data-command
                type="button"
                className="workspace-menu-item w-full text-left hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  onClose();
                  requestAnimationFrame(() =>
                    window.dispatchEvent(new CustomEvent('jackalope:open-shortcuts')),
                  );
                }}
              >
                <Keyboard className="size-4 text-[var(--color-accent-ink)]" />
                <span>Keyboard shortcuts</span>
                <kbd>?</kbd>
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
                <span>{item.id === 'live-sessions' ? 'Chat' : item.label}</span>
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
              !files.length &&
              !matchingProjects.length &&
              !actions.length &&
              !(onCapture && 'new task capture idea'.includes(search)) && (
                <p className="p-6 text-sm text-[var(--color-text-secondary)]">
                  No matches. Try a file name, “agents” or a color.
                </p>
              )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
