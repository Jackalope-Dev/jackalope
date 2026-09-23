import { applyThemeTokens, startThemeClock } from '@jackalope/brand/theme';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { SquareArrowOutUpRight, SquareTerminal } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type CommandStatus, commandStatus, installSystemCommand } from '../../lib/cli-terminal';
import { nativeTask } from '../../lib/task-runtime';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import '@xterm/xterm/css/xterm.css';
import '../ui/experience.css';
import './cli-terminal.css';

interface TerminalView {
  generation: string;
  running: boolean;
  output: string;
  cursor: number;
  reset: boolean;
}

function message(cause: unknown) {
  return typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : String(cause);
}

/**
 * A window running the `jackalope` command. Conversations belong to the app,
 * not to this window, so closing it or moving to another terminal never stops
 * work.
 */
export default function CliTerminalWindow({ id, directory }: { id: string; directory: string }) {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<CommandStatus | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const moveButton = useRef<HTMLButtonElement>(null);
  const appTheme = useThemeStore((state) => state.appTheme);
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.path === directory),
  );
  const name = project?.name ?? directory.split(/[\\/]/).filter(Boolean).pop() ?? 'Project';

  useEffect(startThemeClock, []);
  useEffect(() => {
    applyThemeTokens(project?.preferences?.theme ?? appTheme);
  }, [project?.preferences?.theme, appTheme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'jackalope-theme') void useThemeStore.persist.rehydrate();
      if (event.key === 'jackalope-projects') void useProjectStore.persist.rehydrate();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    void commandStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const start = useCallback(async () => {
    setError('');
    try {
      setTerminalId(await nativeTask<string>('cli_terminal_start', { key: id, directory }));
      setRunning(true);
    } catch (cause) {
      setError(message(cause));
    }
  }, [id, directory]);
  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (!terminalId || !host.current) return;
    let disposed = false;
    let generation = '';
    let cursor = 0;
    let writable = false;
    let loading = false;
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: Math.max(11, Math.min(20, useSettingsStore.getState().terminalFontSize || 13)),
      scrollback: 5000,
      screenReaderMode: true,
    });
    const openLink = (_event: MouseEvent, uri: string) => {
      if (useSettingsStore.getState().terminalLinks && /^https?:\/\//i.test(uri))
        void openExternalUrl(uri);
    };
    terminal.loadAddon(new WebLinksAddon(openLink));
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    terminal.textarea?.setAttribute(
      'aria-label',
      'Jackalope terminal. Shift+Escape moves focus to the window controls.',
    );
    const theme = () => {
      const style = getComputedStyle(document.documentElement);
      const color = (token: string) => style.getPropertyValue(token).trim();
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
      if (writable && generation)
        void nativeTask('task_terminal_resize', {
          id: terminalId,
          generation,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Escape' && event.shiftKey) {
        if (event.type === 'keydown') moveButton.current?.focus();
        return false;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'c' &&
        terminal.hasSelection()
      ) {
        if (event.type === 'keydown') {
          event.preventDefault();
          void navigator.clipboard.writeText(terminal.getSelection()).catch(() => {});
        }
        return false;
      }
      return true;
    });
    const input = terminal.onData((data) => {
      if (writable && generation)
        void nativeTask('task_terminal_write', { id: terminalId, generation, input: data }).catch(
          (cause) => {
            if (!disposed) setError(message(cause));
          },
        );
    });
    const load = async () => {
      if (loading || disposed) return;
      loading = true;
      try {
        const view = await nativeTask<TerminalView | null>('task_terminal_status', {
          id: terminalId,
          cursor,
          generation,
        });
        if (disposed || !view) return;
        writable = view.running;
        setRunning(view.running);
        const changed = view.generation !== generation;
        generation = view.generation;
        if (view.reset) terminal.reset();
        if (changed) resize();
        if (view.output) terminal.write(view.output);
        cursor = view.cursor;
      } catch (cause) {
        if (!disposed) setError(message(cause));
      } finally {
        loading = false;
      }
    };
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      clearTimeout(timer);
      await load();
      // A conversation redraws continuously while an agent works, so poll
      // quickly while the command runs and back off when hidden or finished.
      if (!disposed) timer = setTimeout(tick, document.hidden ? 4000 : writable ? 60 : 1500);
    };
    void tick();
    document.addEventListener('visibilitychange', tick);
    terminal.focus();
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', tick);
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      terminal.dispose();
    };
  }, [terminalId]);

  const moveToSystemTerminal = async () => {
    setBusy(true);
    setError('');
    try {
      await nativeTask('cli_terminal_popout', { key: id, directory });
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
    }
  };
  const installCommand = async () => {
    setError('');
    try {
      setStatus(await installSystemCommand());
    } catch (cause) {
      setError(message(cause));
    }
  };
  const missing = status && (!status.command || status.onPath === false);

  return (
    <MotionConfig reducedMotion="user">
      <main className="cli-terminal-window">
        <header>
          <h1>
            <SquareTerminal size={16} aria-hidden="true" />
            <span className="cli-terminal-title">{name}</span>
          </h1>
          <div className="cli-terminal-actions">
            {!running && (
              <Button variant="outline" onClick={() => void start()}>
                Start again
              </Button>
            )}
            <Button
              ref={moveButton}
              variant="outline"
              disabled={busy}
              loading={busy}
              loadingLabel="Opening…"
              onClick={() => void moveToSystemTerminal()}
            >
              <SquareArrowOutUpRight size={16} aria-hidden="true" />
              Open in Terminal
            </Button>
          </div>
        </header>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        {missing && !error && (
          <InlineNotice
            tone="info"
            action={
              status.systemAvailable ? (
                <Button variant="outline" onClick={() => void installCommand()}>
                  Install command
                </Button>
              ) : undefined
            }
          >
            {status.skipped ??
              status.error ??
              (status.command
                ? `jackalope is installed at ${status.command}, but that folder is not on your shell's PATH.`
                : 'jackalope is not on your PATH yet, so it only runs here.')}
          </InlineNotice>
        )}
        {!running && !error && (
          <p role="status" className="cli-terminal-ended">
            This terminal has ended. Your conversations keep running in Jackalope.
          </p>
        )}
        <div ref={host} className="cli-terminal-screen" />
      </main>
    </MotionConfig>
  );
}
