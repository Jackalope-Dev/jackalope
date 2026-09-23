import { useCallback, useEffect, useState } from 'react';
import { useManagedRuntime } from '../../lib/managed-runtime';
import { nativeTask } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { ManagedRuntimeProgress } from './ManagedRuntimeProgress';

interface RuntimeStatus {
  supported: boolean;
  installed: boolean;
  version: string;
  detail: string | null;
  diskBytes: number | null;
  source: string;
  installedVersion: string | null;
}

export function ManagedRuntimeSettings() {
  const runner = useManagedRuntime();
  const [status, setStatus] = useState<RuntimeStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(
    async () => setStatus(await nativeTask<RuntimeStatus>('managed_runtime_status')),
    [],
  );
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);
  const run = async (action: 'prepare' | 'cleanup' | 'remove') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'prepare') await runner.prepare(false);
      else {
        const result = await nativeTask<{ removed: number; retained: number }>(
          'managed_runtime_cleanup',
          { removeActive: action === 'remove' },
        );
        setNotice(
          `${result.removed} runner folders removed. ${result.retained} retained because they are selected, in use, or contain other files.`,
        );
      }
      await refresh();
      await useExecutionStore.getState().discover();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid gap-3" aria-label="Private runner">
      <div>
        <h3 className="font-medium">Private OpenCode runner</h3>
        <p className="task-muted text-sm">
          {status
            ? `${status.source} · ${status.installedVersion ?? status.version} · ${status.installed ? 'Integrity verified' : 'Not ready'}`
            : 'Checking runner…'}
          {status?.diskBytes != null &&
            ` · ${(status.diskBytes / 1_048_576).toFixed(1)} MB on disk`}
        </p>
        {status?.installedVersion && status.installedVersion !== status.version && (
          <p className="task-muted text-sm">Repair installs pinned version {status.version}.</p>
        )}
        <p className="task-muted text-sm">
          An executable override takes precedence. Removing the private runner keeps your accounts
          and models.
        </p>
      </div>
      {status?.detail && <InlineNotice tone="error">{status.detail}</InlineNotice>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || !status?.supported}
          onClick={() => void run('prepare')}
        >
          {status?.installed ? 'Check & repair' : 'Prepare runner'}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !status?.diskBytes}
          onClick={() => void run('cleanup')}
        >
          Clean unused versions
        </Button>
        <Button
          variant="outline"
          disabled={busy || !status?.diskBytes}
          onClick={() => void run('remove')}
        >
          Remove idle runner
        </Button>
      </div>
      {runner.preparing && (
        <ManagedRuntimeProgress
          progress={runner.progress}
          onCancel={() => void runner.cancel().catch((cause) => setError(String(cause)))}
        />
      )}
      {notice && (
        <p role="status" className="task-muted text-sm">
          {notice}
        </p>
      )}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </section>
  );
}
