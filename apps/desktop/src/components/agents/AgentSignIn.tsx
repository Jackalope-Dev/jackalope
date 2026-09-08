import * as Dialog from '@radix-ui/react-dialog';

import { FitAddon } from '@xterm/addon-fit';

import { WebLinksAddon } from '@xterm/addon-web-links';

import { Terminal } from '@xterm/xterm';

import { useEffect, useRef, useState } from 'react';

import {
  type AccountStatus,
  accountStatusLabel,
  checkAgentProfile,
  pollSignIn,
  resizeSignIn,
  signInAgentProfile,
  stopSignIn,
  writeSignIn,
} from '../../lib/agent-profiles';

import { Button } from '../ui/button';

import '@xterm/xterm/css/xterm.css';

export function AgentSignIn({
  agentId,
  agentName,
  profileId,
  profileName,
  onStatus,
  onClose,
}: {
  agentId: string;
  agentName: string;
  profileId: string;
  profileName: string;

  onStatus: (status: AccountStatus | undefined) => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  const session = useRef<string | null>(null);

  const report = useRef(onStatus);

  report.current = onStatus;

  const [attempt, setAttempt] = useState(0);

  const [stage, setStage] = useState('Starting sign-in…');

  const [running, setRunning] = useState(true);

  const [checking, setChecking] = useState(false);

  const [error, setError] = useState('');

  const [result, setResult] = useState<AccountStatus>();

  useEffect(() => {
    if (!host.current) return;

    let disposed = false;

    let timer: ReturnType<typeof setTimeout>;

    let id: string | null = null;

    let cursor = 0;

    setRunning(true);

    setError('');

    setResult(undefined);

    setStage('Starting sign-in…');

    report.current(undefined);

    const terminal = new Terminal({
      cursorBlink: false,
      fontSize: 14,
      scrollback: 500,
      screenReaderMode: true,
      allowProposedApi: false,
    });

    const fit = new FitAddon();

    terminal.loadAddon(fit);

    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();

        const url = new URL(uri);

        if (url.protocol !== 'https:' || url.username || url.password) return;

        void import('@tauri-apps/plugin-shell')
          .then(({ open }) => open(url.href))
          .catch(() => {
            if (!disposed)
              setError('Could not open the browser. Copy the sign-in link from the panel.');
          });
      }),
    );

    terminal.open(host.current);

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

    const observer = new MutationObserver(theme);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme'],
    });

    const resize = new ResizeObserver(() => {
      fit.fit();

      if (id) void resizeSignIn(id, terminal.cols, terminal.rows).catch(() => {});
    });

    resize.observe(host.current);

    fit.fit();

    terminal.textarea?.setAttribute('aria-label', `${agentName} sign-in input`);

    terminal.attachCustomKeyEventHandler((event) => event.key !== 'Tab' && event.key !== 'Escape');

    const input = terminal.onData((data) => {
      if (id)
        void writeSignIn(id, data).catch((e) => {
          if (!disposed) setError(String(e));
        });
    });

    const verify = async () => {
      setChecking(true);

      try {
        const status = await checkAgentProfile(agentId, profileId);

        if (!disposed) {
          setResult(status);
          report.current(status);
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        if (!disposed) setChecking(false);
      }
    };

    const poll = async () => {
      if (!id || disposed) return;

      try {
        const view = await pollSignIn(id, cursor);

        if (disposed) return;

        if (view.truncated) terminal.reset();

        for (const chunk of view.chunks) {
          terminal.write(chunk.data);
          cursor = chunk.sequence;
        }

        if (view.state === 'running') {
          timer = setTimeout(() => void poll(), 250);
          return;
        }

        setRunning(false);

        terminal.options.disableStdin = true;

        if (view.state === 'exited' && view.exitCode === 0) {
          setStage('Sign-in finished');

          await verify();
        } else {
          setStage(view.state === 'timedOut' ? 'Sign-in timed out' : 'Sign-in did not finish');

          setError('Review the provider message below, then retry.');
        }
      } catch (e) {
        if (!disposed) {
          setRunning(false);
          setError(String(e));
        }

        if (id) void stopSignIn(id).catch(() => {});
      }
    };

    void signInAgentProfile(agentId, profileId, terminal.cols, terminal.rows)
      .then(async (value) => {
        id = value;

        if (disposed) {
          await stopSignIn(value);
          return;
        }

        session.current = value;

        setStage('Complete the provider’s sign-in below');

        terminal.focus();

        await poll();
      })
      .catch((e) => {
        if (!disposed) {
          setRunning(false);
          setStage('Could not start sign-in');
          setError(String(e));
        }
      });

    return () => {
      disposed = true;

      clearTimeout(timer);

      session.current = null;

      if (id) void stopSignIn(id).catch(() => {});

      input.dispose();
      resize.disconnect();
      observer.disconnect();
      terminal.dispose();
    };
  }, [agentId, agentName, profileId, attempt]);

  const close = async () => {
    if (session.current) {
      try {
        await stopSignIn(session.current);
      } catch (e) {
        setError(String(e));
        return;
      }
    }

    onClose();
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content
          className="task-dialog appearance-panel agent-sign-in-dialog"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title className="text-xl font-medium">
            Sign in to {agentName} · {profileName}
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-2">
            Follow the prompts here. Your browser may open for provider authorization. When
            reconnecting, use the same identity to preserve existing task continuations.
          </Dialog.Description>
          <p role="status" className="mt-4">
            {checking ? 'Checking account…' : result ? accountStatusLabel(result) : stage}
          </p>
          {result && (
            <div className="agent-account-status">
              <strong>{result.identity}</strong>
              <p className="task-muted">{result.detail}</p>
            </div>
          )}
          {error && (
            <p role="alert" className="task-error mt-2">
              {error}
            </p>
          )}
          <div className="agent-sign-in-terminal" ref={host} />
          <div className="flex flex-wrap justify-end gap-3 mt-4">
            {!running && !checking && (
              <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                Retry sign-in
              </Button>
            )}
            <Button variant={running ? 'outline' : 'primary'} onClick={() => void close()}>
              {running ? 'Cancel sign-in' : 'Done'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
