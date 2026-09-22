import { Input } from '@jackalope/ui';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { sessionCommand } from '../../lib/live-session';
import { isActive, nativeTask, type TaskRun } from '../../lib/task-runtime';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { saveWorkFeedback } from '../../lib/work-feedback';
import { useSavedActionsStore } from '../../stores/savedActionsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import '@xterm/xterm/css/xterm.css';
import './task-terminal.css';

interface TerminalView {
  generation: string;
  workspace: string;
  running: boolean;
  output: string;
  cursor: number;
  reset: boolean;
}
export function TaskTerminal({ run }: { run: TaskRun }) {
  const splitKey = `terminal:${run.taskId}`;
  const split = useWorkViewStore((state) => state.split[splitKey] ?? false);
  return (
    <div className="terminal-workspace">
      <Button
        variant="ghost"
        aria-pressed={split}
        onClick={() => useWorkViewStore.getState().setSplit(splitKey, !split)}
      >
        {split ? 'Hide second terminal' : 'Split terminal'}
      </Button>
      <div className={split ? 'terminal-panes is-split' : 'terminal-panes'}>
        <TerminalPane run={run} slot="main" />
        {split && <TerminalPane run={run} slot="split" />}
      </div>
      {split && (
        <p className="task-muted">
          Both shells reserve this workspace. Stop both before resuming agent work. Hiding a pane
          leaves its shell running.
        </p>
      )}
    </div>
  );
}
function TerminalPane({ run, slot }: { run: TaskRun; slot: 'main' | 'split' }) {
  const terminalId = slot === 'main' ? run.taskId : `${run.taskId}::split`;
  const host = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const reload = useRef<() => Promise<void>>(async () => {});
  const generationRef = useRef('');
  const [workspace, setWorkspace] = useState(run.workspace);
  const [running, setRunning] = useState(false);
  const [savedOutput, setSavedOutput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const selectionText = useRef<() => string>(() => '');
  const terminalRef = useRef<Terminal | null>(null);
  const [query, setQuery] = useState('');
  const [searchMessage, setSearchMessage] = useState('');
  const searchLine = useRef(-1);
  const savedCommands = useSavedActionsStore((state) => state.actions).filter(
    (action) =>
      action.kind === 'command' && (!action.projectId || action.projectId === run.projectId),
  );
  const [commandId, setCommandId] = useState('');
  const command = savedCommands.find((action) => action.id === commandId);
  const findOutput = () => {
    const terminal = terminalRef.current;
    if (!terminal || !query) return;
    const buffer = terminal.buffer.active;
    for (let offset = 1; offset <= buffer.length; offset++) {
      const row = (searchLine.current + offset) % buffer.length;
      const line = buffer.getLine(row);
      if (!line) continue;
      const text = line.translateToString();
      const index = text.toLowerCase().indexOf(query.toLowerCase());
      if (index >= 0) {
        let chars = 0;
        let start = 0;
        let end = 0;
        for (let column = 0; column < line.length; column++) {
          const cell = line.getCell(column);
          if (!cell || cell.getWidth() === 0) continue;
          const length = (cell.getChars() || ' ').length;
          if (chars <= index) start = column;
          end = column + cell.getWidth();
          chars += length;
          if (chars >= index + query.length) break;
        }
        terminal.select(start, row, end - start);
        terminal.scrollToLine(row);
        searchLine.current = row;
        setSearchMessage(`Match on line ${row + 1}`);
        return;
      }
    }
    setSearchMessage('No match in retained output.');
  };
  useEffect(() => {
    if (!host.current || !isTauriEnvironment()) return;
    let disposed = false;
    let loading = false;
    let cursor = 0;
    let generation = '';
    let writable = false;
    let restored = false;
    generationRef.current = '';
    setWorkspace(run.workspace);
    setRunning(false);
    setSavedOutput(false);
    setHasSelection(false);
    setFeedbackSaved(false);
    const terminal = new Terminal({
      cursorBlink: false,
      fontSize: Math.max(11, Math.min(20, useSettingsStore.getState().terminalFontSize || 13)),
      scrollback: 3000,
      screenReaderMode: true,
      linkHandler: {
        activate: (_event, uri) => {
          if (useSettingsStore.getState().terminalLinks && /^https?:\/\//i.test(uri))
            void openExternalUrl(uri);
        },
      },
    });
    terminalRef.current = terminal;
    terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        if (useSettingsStore.getState().terminalLinks && /^https?:\/\//i.test(uri))
          void openExternalUrl(uri);
      }),
    );
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    terminal.textarea?.setAttribute(
      'aria-label',
      'Task terminal input. Shift+Escape returns to terminal controls.',
    );
    const theme = () => {
      const style = getComputedStyle(document.documentElement);
      const color = (name: string) => style.getPropertyValue(name).trim();
      terminal.options.fontFamily = color('--font-mono');
      terminal.options.theme = {
        background: color('--color-surface-sunken'),
        foreground: color('--color-text-primary'),
        cursor: color('--color-accent-ink'),
        selectionBackground: color('--color-surface-hover'),
      };
    };
    theme();
    const themeObserver = new MutationObserver(theme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme'],
    });
    const resize = () => {
      if (disposed || !host.current?.clientWidth) return;
      fit.fit();
      if (writable)
        void nativeTask('task_terminal_resize', {
          id: terminalId,
          generation,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    const unsubscribeSettings = useSettingsStore.subscribe((settings) => {
      terminal.options.fontSize = Math.max(11, Math.min(20, settings.terminalFontSize));
      resize();
    });
    observer.observe(host.current);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Escape' && event.shiftKey) {
        if (event.type === 'keydown') action.current?.focus();
        return false;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'c' &&
        terminal.hasSelection()
      ) {
        if (event.type === 'keydown') {
          event.preventDefault();
          void navigator.clipboard
            .writeText(terminal.getSelection())
            .catch((cause) => setError(String(cause)));
        }
        return false;
      }
      return !(event.key === 'Tab' && event.shiftKey);
    });
    const input = terminal.onData((input) => {
      if (writable)
        void nativeTask('task_terminal_write', { id: terminalId, generation, input }).catch(
          (cause) => {
            if (!disposed) setError(String(cause));
          },
        );
    });
    selectionText.current = () => terminal.getSelection();
    const selection = terminal.onSelectionChange(() => setHasSelection(terminal.hasSelection()));
    const load = async () => {
      if (loading || disposed || document.hidden) return;
      loading = true;
      try {
        let view = await nativeTask<TerminalView | null>('task_terminal_status', {
          id: terminalId,
          cursor,
          generation,
        });
        if (!view && !restored && useSettingsStore.getState().retainTerminalOutput) {
          restored = true;
          view = await nativeTask<TerminalView | null>('task_terminal_restore', {
            id: run.taskId,
            slot,
          });
          if (!disposed) setSavedOutput(!!view);
        } else if (view && !disposed) {
          setSavedOutput(false);
        }
        if (disposed) return;
        writable = view?.running ?? false;
        setRunning(writable);
        if (view) {
          const changed = generation !== view.generation;
          generation = view.generation;
          generationRef.current = generation;
          setWorkspace(view.workspace);
          if (view.reset) terminal.reset();
          if (changed) resize();
          if (view.output) terminal.write(view.output);
          cursor = view.cursor;
        }
      } catch (cause) {
        if (!disposed) setError(String(cause));
      } finally {
        loading = false;
      }
    };
    reload.current = load;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      clearTimeout(timer);
      await load();
      if (!disposed) timer = setTimeout(tick, document.hidden ? 8000 : writable ? 250 : 2000);
    };
    void tick();
    document.addEventListener('visibilitychange', tick);
    return () => {
      disposed = true;
      reload.current = async () => {};
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', tick);
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      selection.dispose();
      selectionText.current = () => '';
      terminal.dispose();
      terminalRef.current = null;
      unsubscribeSettings();
    };
  }, [run.taskId, run.workspace, slot, terminalId]);
  const change = async () => {
    setBusy(true);
    setError('');
    try {
      if (!running && run.liveSessionId)
        await sessionCommand('action', { id: run.liveSessionId, action: 'pause' });
      await nativeTask(running ? 'task_terminal_stop' : 'task_terminal_start', {
        id: running ? terminalId : run.id,
        slot,
        retainOutput: useSettingsStore.getState().retainTerminalOutput,
        ...(running ? { generation: generationRef.current } : {}),
        ...(!running ? { shell: useSettingsStore.getState().terminalShell } : {}),
      });
      await reload.current();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="task-terminal"
      aria-label={slot === 'main' ? 'Main task terminal' : 'Second task terminal'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          {slot === 'split' ? 'Second shell · ' : ''}
          {running
            ? 'Terminal running · stop it to resume agent work'
            : savedOutput
              ? 'Saved output · start a new shell to continue'
              : 'Shell in this task’s workspace'}
        </p>
        <Button
          ref={action}
          variant="outline"
          disabled={
            busy ||
            !isTauriEnvironment() ||
            (!running && (isActive(run) || run.status === 'interrupted' || !!run.finishing))
          }
          onClick={() => void change()}
        >
          {running ? 'Stop terminal' : 'Start terminal'}
        </Button>
      </div>
      <p className="work-context-path">{workspace}</p>
      {!!savedCommands.length && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Saved terminal command"
            value={commandId || '__choose'}
            onValueChange={setCommandId}
          >
            <SelectItem value="__choose" disabled>
              Choose a saved command…
            </SelectItem>
            {savedCommands.map((action) => (
              <SelectItem key={action.id} value={action.id}>
                {action.name}
              </SelectItem>
            ))}
          </Select>
          <Button
            variant="outline"
            disabled={!command || !running || busy}
            onClick={() => {
              if (!command) return;
              setBusy(true);
              void nativeTask('task_terminal_write', {
                id: terminalId,
                generation: generationRef.current,
                input: `${command.body}\r`,
              })
                .catch((reason) => setError(String(reason)))
                .finally(() => setBusy(false));
            }}
          >
            Run command
          </Button>
          {command && <code className="work-context-path">{command.body}</code>}
        </div>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          findOutput();
        }}
      >
        <Input
          aria-label="Find terminal output"
          placeholder="Find in output…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            searchLine.current = -1;
            setSearchMessage('');
          }}
        />
        <Button variant="outline" type="submit" disabled={!query}>
          Find next
        </Button>
        <span role="status">{searchMessage}</span>
      </form>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <div ref={host} className="task-terminal-screen" />
      {hasSelection && (
        <Button
          variant="outline"
          onClick={() => {
            try {
              saveWorkFeedback(
                run.taskId,
                run.id,
                `Terminal selection from ${workspace}:\n\n${selectionText.current()}`,
              );
              setError('');
              setFeedbackSaved(true);
            } catch (cause) {
              setError(String(cause));
            }
          }}
        >
          Save selected output as task feedback
        </Button>
      )}
      {feedbackSaved && (
        <InlineNotice>Output saved. Add it to your reply from saved feedback.</InlineNotice>
      )}
      <small>
        Closing this view keeps the shell running. Shift+Escape returns to controls. Closing
        Jackalope stops the shell.
      </small>
    </section>
  );
}
