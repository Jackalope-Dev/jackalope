import { CopyButton } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Setting } from './Setting';

interface CommandStatus {
  command: string | null;
  onPath: boolean | null;
  skipped: string | null;
  error: string | null;
  systemAvailable: boolean;
}

/** Whether `jackalope` works in a terminal, and the one step to make it work when not. */
export function CliCommandSetting() {
  const [status, setStatus] = useState<CommandStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    nativeTask<CommandStatus>('cli_install_status')
      .then(setStatus)
      .catch((cause) => setError(String(cause)));
  }, []);
  if (!isTauriEnvironment()) return null;

  const install = async () => {
    setInstalling(true);
    setError('');
    try {
      setStatus(await nativeTask<CommandStatus>('cli_install_system'));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setInstalling(false);
    }
  };

  const ready = !!status?.command && status.onPath !== false;
  const description = !status
    ? 'Checking…'
    : ready
      ? 'Run jackalope in any repository to talk to your agents from the terminal.'
      : status.command
        ? 'The command is installed, but its folder is not on your terminal’s PATH yet.'
        : (status.skipped ?? 'The jackalope command is not installed.');
  return (
    <Setting title="Command line tool" description={description}>
      <div className="flex flex-col items-end gap-2">
        {ready ? (
          <span className="flex items-center gap-2">
            <code className="font-mono text-sm">jackalope</code>
            <CopyButton text="jackalope" label="Copy command" />
          </span>
        ) : (
          status?.systemAvailable && (
            <Button
              variant="outline"
              loading={installing}
              loadingLabel="Installing…"
              onClick={() => void install()}
            >
              Install jackalope command
            </Button>
          )
        )}
        {status?.command && !ready && (
          <code className="font-mono text-xs task-muted" title={status.command}>
            {status.command}
          </code>
        )}
        {(error || status?.error) && (
          <InlineNotice tone="error">{error || status?.error}</InlineNotice>
        )}
      </div>
    </Setting>
  );
}
