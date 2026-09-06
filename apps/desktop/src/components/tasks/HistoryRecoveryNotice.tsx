import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Copy, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import './history-recovery.css';

interface HistoryRecovery {
  directory: string;
  entries: { path: string; reason: string; quarantined: boolean }[];
}

export function HistoryRecoveryNotice() {
  const [recovery, setRecovery] = useState<HistoryRecovery | null>(null);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');

  const load = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    const current = ++requestId.current;
    setLoading(true);
    try {
      const result = await nativeTask<HistoryRecovery>('task_history_recovery');
      if (current === requestId.current) {
        setRecovery(result);
        setError('');
      }
    } catch (error) {
      if (current === requestId.current) setError(String(error));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      requestId.current++;
    };
  }, [load]);

  const copy = async (path: string, label: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopyStatus(`${label} copied.`);
    } catch {
      setCopyStatus('Could not copy. Select the path below and copy it manually.');
    }
  };

  if (error)
    return (
      <div className="history-recovery-notice">
        <p role="status" className="min-w-0 flex-1">
          {loading ? 'Checking task history…' : 'Could not check for unreadable task history.'}
        </p>
        {!loading && (
          <details className="min-w-0">
            <summary className="task-summary">Error details</summary>
            <p className="history-recovery-path">{error}</p>
          </details>
        )}
        <Button variant="ghost" disabled={loading} onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  if (!recovery?.entries.length) return null;

  const count = recovery.entries.length;
  return (
    <Dialog.Root onOpenChange={() => setCopyStatus('')}>
      <div className="history-recovery-notice">
        <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />
        <p role="status" className="min-w-0 flex-1">
          {count} task history {count === 1 ? 'file needs' : 'files need'} attention.
        </p>
        <Dialog.Trigger asChild>
          <Button variant="ghost">Review files</Button>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content className="task-dialog appearance-panel history-recovery-dialog">
          <Dialog.Close className="task-close" aria-label="Close history recovery">
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-xl font-medium pr-10">
            Task history needs attention
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-3">
            These files could not be loaded. Other readable tasks are still available. This report
            covers all projects in this app profile, as of startup.
          </Dialog.Description>
          <p className="task-muted mt-3">
            Files set aside are preserved for inspection. Close Jackalope before repairing history,
            and keep a separate backup. Restart after repairs to reload the history.
          </p>
          <div className="history-recovery-folder">
            <h3 className="text-base font-medium">History folder</h3>
            <p className="history-recovery-path">{recovery.directory}</p>
            <Button variant="outline" onClick={() => void copy(recovery.directory, 'Folder path')}>
              <Copy size={16} aria-hidden="true" /> Copy folder path
            </Button>
          </div>
          <p role="status" className="task-muted" aria-live="polite">
            {copyStatus}
          </p>
          <ul className="history-recovery-files">
            {recovery.entries.map((entry) => (
              <li key={entry.path}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-medium">
                    {entry.quarantined ? 'Set aside' : 'Original remains in place'}
                  </h3>
                  <Button
                    variant="ghost"
                    aria-label={`Copy path for ${entry.path}`}
                    onClick={() => void copy(entry.path, 'File path')}
                  >
                    <Copy size={16} aria-hidden="true" /> Copy path
                  </Button>
                </div>
                <p className="history-recovery-path">{entry.path}</p>
                <p className="task-muted mt-2">{entry.reason}</p>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
