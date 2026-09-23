import * as Dialog from '@radix-ui/react-dialog';
import { Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { returnToCompanion, useCompanionNotices } from '../mascot/useCompanionNotices';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';
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
  const [open, setOpen] = useState(false);

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

  const count = recovery?.entries.length ?? 0;
  useCompanionNotices(
    'history',
    error
      ? [
          {
            id: 'history-check-error',
            title: 'Could not check task history',
            detail: error,
            kind: 'attention',
            actionLabel: 'Review history check',
            onOpen: () => setOpen(true),
          },
        ]
      : count
        ? [
            {
              id: `history:${recovery?.entries.map((entry) => entry.path).join('|')}`,
              title: 'Task history needs attention',
              detail: `${count} ${count === 1 ? 'file needs' : 'files need'} recovery or inspection.`,
              kind: 'attention',
              actionLabel: 'Review files',
              onOpen: () => setOpen(true),
            },
          ]
        : [],
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setCopyStatus('');
      }}
    >
      <DialogContent className="history-recovery-dialog" onCloseAutoFocus={returnToCompanion}>
        <DialogCloseButton label="Close history recovery" />
        <DialogHeader
          title="
            Task history needs attention
          "
          description={
            <>
              These files need recovery or inspection. Other readable tasks are still available.
              This report covers task records, unfinished saves and queue history across this app
              profile, as of startup.
            </>
          }
        />
        {error && (
          <div className="my-4">
            <InlineNotice tone="error" role="status">
              {loading ? 'Checking task history…' : error}
            </InlineNotice>
            <Button variant="ghost" disabled={loading} onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        {!error && !count && (
          <p className="task-muted mt-3">No unreadable history files were found.</p>
        )}
        {recovery && count > 0 && (
          <>
            <p className="task-muted mt-3">
              Files set aside are preserved for inspection. Close Jackalope before repairing
              history, and keep a separate backup. Restart after repairs to reload the history.
            </p>
            <div className="history-recovery-folder">
              <h3 className="text-base font-medium">History folder</h3>
              <p className="history-recovery-path">{recovery.directory}</p>
              <Button
                variant="outline"
                onClick={() => void copy(recovery.directory, 'Folder path')}
              >
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
          </>
        )}
      </DialogContent>
    </Dialog.Root>
  );
}
