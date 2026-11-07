import { PRESET_THEMES, withPreset } from '@jackalope/brand/theme';
import { SearchField } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { FileText, Folder, MessageSquare, Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { emitAppEvent } from '../../lib/app-events';
import { describeError } from '../../lib/errors';
import { searchFiles } from '../../lib/file-search';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { attachmentReference } from '../../lib/prompt-attachments';
import { isSettled } from '../../lib/run-status';
import { displayShortcut, resolveShortcuts } from '../../lib/shortcuts';
import { workShape } from '../../lib/task-collection';
import { taskDecision } from '../../lib/task-workflow';
import { showWork, useWorkspaceWork, workProjectId } from '../../lib/work-selection';
import { useExecutionStore } from '../../stores/executionStore';
import { useHostContextStore } from '../../stores/hostContextStore';
import { useActiveProject, useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { type Command, type CommandContext, matchingCommands } from './commands';
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
    invokeNative<string[]>('project_files_list', { projectPath })
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
  onSelectProject,
  context,
  onCommand,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: ActiveTab) => void;
  onSelectProject: (id: string) => void;
  context: CommandContext;
  onCommand: (command: Command) => void;
}) {
  const [query, setQuery] = useState('');
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const previousFocus = useRef<HTMLElement | null>(null);
  const setTheme = useThemeStore((state) => state.setTheme);
  const search = query.trim().toLowerCase();
  const projects = useProjectStore((state) => state.projects);
  const runs = useExecutionStore((state) => state.runs);
  const selected = useExecutionStore((state) => state.selectedId);
  const current = runs.find((run) => run.id === selected);
  const workspaceWork = useWorkspaceWork({ withoutDrafts: true });
  const work = workspaceWork
    .map((item) => ({
      item,
      project: projects.find((project) => project.id === workProjectId(item))?.name ?? '',
      state: item.statusLabel ?? workShape(item),
    }))
    .filter(({ item, project, state }) =>
      `${item.title} ${project} ${state}`.toLowerCase().includes(search),
    )
    .sort((a, b) => Date.parse(b.item.date) - Date.parse(a.item.date))
    .slice(0, 8);
  const matchingProjects = projects
    .filter((project) => `${project.name} ${project.path}`.toLowerCase().includes(search))
    .slice(0, 6);
  const actions = current
    ? [
        { label: taskDecision(current).action, section: taskDecision(current).section },
        { label: 'Open conversation', section: 'result' },
        { label: 'Open task terminal and workspace tools', section: 'terminal' },
        ...(isSettled(current)
          ? [
              { label: 'Try result', section: 'preview' },
              { label: 'Review changes and checks', section: 'changes' },
              { label: 'Prepare delivery', section: 'delivery' },
            ]
          : []),
      ].filter((action) => action.label.toLowerCase().includes(search))
    : [];
  const commands = matchingCommands(context, search);
  const activeProject = useActiveProject();
  const remoteHost = useHostContextStore((state) => state.host);
  const views = WORKSPACE_VIEWS.filter(
    (item: { label: string; description: string; keywords?: string }) =>
      `${item.label} ${item.description} ${item.keywords ?? ''}`.toLowerCase().includes(search),
  );
  const themes = PRESET_THEMES.filter((item) => item.name.toLowerCase().includes(search));
  const preferredEditor = useSettingsStore((state) => state.preferredEditor);
  const projectFiles = useProjectFiles(activeProject?.path, isOpen && !remoteHost);
  const files = search.length >= 2 ? searchFiles(projectFiles, search, 8) : [];
  const [fileError, setFileError] = useState('');
  const resultCount =
    actions.length +
    work.length +
    matchingProjects.length +
    files.length +
    commands.length +
    views.length +
    themes.length;

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
            {work.map(({ item, project, state }) => (
              <button
                key={item.id}
                data-command
                type="button"
                className="workspace-menu-item w-full text-left"
                onClick={() => {
                  showWork(item);
                  onNavigate('kanban');
                  onClose();
                }}
              >
                <MessageSquare size={16} />
                <span className="min-w-0">
                  <span className="block truncate">{item.title}</span>
                  <small className="block text-[var(--color-text-secondary)]">
                    {[project, state].filter(Boolean).join(' · ')}
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
                  onSelectProject(project.id);
                  useWorkViewStore.getState().setScope('project');
                  onNavigate('project-overview');
                  onClose();
                }}
              >
                <Folder size={16} />
                <span>{project.name}</span>
              </button>
            ))}
            {files.length > 0 && activeProject && (
              <p className="menu-label">Files in {activeProject.name}</p>
            )}
            {fileError && (
              <p className="px-3 pb-2 text-xs text-[var(--color-danger)]" role="alert">
                {fileError}
              </p>
            )}
            {activeProject &&
              files.map((file) => (
                <div key={file} className="command-file-row">
                  <button
                    data-command
                    type="button"
                    className="workspace-menu-item w-full text-left"
                    title={`Open in ${preferredEditor === 'cursor' ? 'Cursor' : 'VS Code'}`}
                    onClick={() => {
                      setFileError('');
                      invokeNative('project_file_open', {
                        projectPath: activeProject.path,
                        relativePath: file,
                        editor: preferredEditor,
                      })
                        .then(onClose)
                        .catch((cause) => setFileError(describeError(cause)));
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
                  <button
                    type="button"
                    className="quiet-icon command-file-attach"
                    aria-label={`Attach ${file} to new work`}
                    title="Attach to new work"
                    onClick={() => {
                      onClose();
                      context.focusComposer();
                      const reference = attachmentReference(
                        `${activeProject.path}/${file}`,
                        activeProject.path,
                      );
                      requestAnimationFrame(() => emitAppEvent('attach-to-composer', [reference]));
                    }}
                  >
                    <Paperclip size={16} />
                  </button>
                </div>
              ))}
            {commands.length + views.length > 0 && <p className="menu-label">Commands</p>}
            {commands.map((command) => (
              <button
                data-command
                type="button"
                key={command.id}
                className="workspace-menu-item w-full text-left"
                onClick={() => {
                  onClose();
                  onCommand(command);
                }}
              >
                <command.icon className="size-4 text-[var(--color-accent-ink)]" />
                <span>{command.label(context)}</span>
                {(command.shortcut || command.key) && (
                  <kbd>
                    {command.shortcut
                      ? displayShortcut(resolveShortcuts(shortcuts)[command.shortcut])
                      : command.key}
                  </kbd>
                )}
              </button>
            ))}
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
                  setTheme(withPreset(theme, useThemeStore.getState().currentTheme));
                  onClose();
                }}
              >
                <span className="size-3 rounded-full" style={{ background: theme.accentHex }} />
                <span>{theme.name}</span>
              </button>
            ))}
            {resultCount === 0 && (
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
