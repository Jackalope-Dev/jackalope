import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState } from 'react';
import { sessionCommand } from '../../lib/live-session';
import { isActive, nativeTask, type TaskRun } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { saveWorkFeedback } from '../../lib/work-feedback';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import '@xterm/xterm/css/xterm.css';

interface TerminalView {
  generation: string;
  workspace: string;
  running: boolean;
  output: string;
  cursor: number;
  reset: boolean;
}
export function TaskTerminal({ run }: { run: TaskRun }) {
  const host = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const reload = useRef<() => Promise<void>>(async () => {});
  const generationRef = useRef('');
  const [workspace, setWorkspace] = useState(run.workspace);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const selectionText = useRef<() => string>(() => '');
  useEffect(() => {
    if (!host.current || !isTauriEnvironment()) return;
    let disposed = false;
    let loading = false;
    let cursor = 0;
    let generation = '';
    let writable = false;
    generationRef.current = '';
    setWorkspace(run.workspace);
    setRunning(false);
    setHasSelection(false);
    setFeedbackSaved(false);
    const terminal = new Terminal({
      cursorBlink: false,
      fontSize: 13,
      scrollback: 3000,
      screenReaderMode: true,
      linkHandler: { activate: () => {} },
    });
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
          id: run.taskId,
          generation,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
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
        void nativeTask('task_terminal_write', { id: run.taskId, generation, input }).catch(
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
        const view = await nativeTask<TerminalView | null>('task_terminal_status', {
          id: run.taskId,
          cursor,
          generation,
        });
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
    };
  }, [run.taskId, run.workspace]);
  const change = async () => {
    setBusy(true);
    setError('');
    try {
      if (!running && run.liveSessionId)
        await sessionCommand('action', { id: run.liveSessionId, action: 'pause' });
      await nativeTask(running ? 'task_terminal_stop' : 'task_terminal_start', {
        id: running ? run.taskId : run.id,
        ...(running ? { generation: generationRef.current } : {}),
      });
      await reload.current();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="task-terminal" aria-label="Task terminal">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          {running
            ? 'Terminal running · stop it to resume agent work'
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
