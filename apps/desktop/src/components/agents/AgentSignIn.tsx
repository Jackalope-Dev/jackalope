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
import { useDialogFocus } from '../ui/useDialogFocus';
import '@xterm/xterm/css/xterm.css';
export function AgentSignIn({
  agentId,
  agentName,
  profileId,
  profileName,
  returnFocus,
  onStatus,
  onClose,
  onUse,
}: {
  agentId: string;
  agentName: string;
  profileId: string;
  profileName: string;
  returnFocus: HTMLElement | null;
  onStatus: (status: AccountStatus | undefined) => void;
  onClose: () => Promise<void>;
  onUse?: () => Promise<void>;
}) {
  const dialogFocus = useDialogFocus();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const session = useRef<string | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const finishingSetup = useRef(false);
  const completeSetup = useRef<(() => Promise<void>) | null>(null);
  const finish = useRef<HTMLButtonElement>(null);
  const report = useRef(onStatus);
  report.current = onStatus;
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState('Starting sign-in…');
  const [running, setRunning] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AccountStatus>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry starts a new owned sign-in session.
  useEffect(() => {
    if (!host) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let id: string | null = null;
    let cursor = 0;
    setRunning(true);
    finishingSetup.current = false;
    setChecking(false);
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
    terminal.open(host);
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
    resize.observe(host);
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
      if (!id || disposed || finishingSetup.current) return;
      try {
        const view = await pollSignIn(id, cursor);
        if (disposed || finishingSetup.current) return;
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
        if (!disposed && !finishingSetup.current) {
          setRunning(false);
          setError(String(e));
        }
        if (id) void stopSignIn(id).catch(() => {});
      }
    };
    completeSetup.current = async () => {
      if (!id || finishingSetup.current) return;
      finishingSetup.current = true;
      clearTimeout(timer);
      setChecking(true);
      setError('');
      try {
        await stopSignIn(id);
        if (disposed) return;
        session.current = null;
        setRunning(false);
        terminal.options.disableStdin = true;
        setStage('Account setup finished');
        await verify();
      } catch (e) {
        if (!disposed) {
          finishingSetup.current = false;
          setChecking(false);
          setError(String(e));
          timer = setTimeout(() => void poll(), 250);
        }
      }
    };
    starting.current = signInAgentProfile(agentId, profileId, terminal.cols, terminal.rows)
      .then(async (value) => {
        id = value;
        if (disposed) {
          await stopSignIn(value);
          return;
        }
        session.current = value;
        setStage('Complete the provider’s sign-in below');
        terminal.focus();
        void poll();
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
      completeSetup.current = null;
      clearTimeout(timer);
      session.current = null;
      if (id) void stopSignIn(id).catch(() => {});
      input.dispose();
      resize.disconnect();
      observer.disconnect();
      terminal.dispose();
    };
  }, [agentId, agentName, profileId, attempt, host]);
  const close = async () => {
    if (saving || checking) return;
    setSaving(true);
    finishingSetup.current = true;
    try {
      await starting.current;
      if (session.current) {
        await stopSignIn(session.current);
        session.current = null;
      }
      await onClose();
    } catch (e) {
      setRunning(false);
      setError(String(e));
    } finally {
      setSaving(false);
    }
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
          {...dialogFocus}
          onCloseAutoFocus={(event) => {
            if (returnFocus?.isConnected) {
              event.preventDefault();
              returnFocus.focus();
            } else {
              dialogFocus.onCloseAutoFocus(event);
            }
          }}
          onKeyDownCapture={(event) => {
            if (event.key === 'Tab' && host?.contains(event.target as Node)) {
              event.preventDefault();
              event.stopPropagation();
              finish.current?.focus();
            }
          }}
          className="task-dialog appearance-panel agent-sign-in-dialog"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title className="text-xl font-medium">
            Sign in to {agentName} · {profileName}
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-2">
            This account has its own sign-in. Follow the provider prompts below or in your browser.
            Choose the intended work or personal identity in the browser. When reconnecting, use the
            same identity to preserve existing task continuations.
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
          <div className="agent-sign-in-terminal" ref={setHost} />
          <div className="flex flex-wrap justify-end gap-3 mt-4">
            {running && ['gemini', 'goose', 'opencode'].includes(agentId) && (
              <Button disabled={saving || checking} onClick={() => void completeSetup.current?.()}>
                Finish setup
              </Button>
            )}
            {!running && !checking && (
              <Button
                variant="outline"
                disabled={saving}
                onClick={async () => {
                  try {
                    if (session.current) await stopSignIn(session.current);
                    session.current = null;
                    setAttempt((n) => n + 1);
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Retry sign-in
              </Button>
            )}
            <Button
              ref={finish}
              variant={running ? 'outline' : 'primary'}
              disabled={saving || checking}
              onClick={() => void close()}
            >
              {running ? 'Cancel sign-in' : 'Done'}
            </Button>
            {!running &&
              !checking &&
              onUse &&
              (result?.state === 'signedIn' || result?.state === 'configured') && (
                <Button
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    setError('');
                    try {
                      if (session.current) await stopSignIn(session.current);
                      await onUse();
                      await onClose();
                    } catch (e) {
                      setError(String(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? 'Saving…' : 'Use for new tasks'}
                </Button>
              )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
