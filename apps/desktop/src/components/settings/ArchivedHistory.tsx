import { Archive, RefreshCw, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ArchivedRun, nativeTask, statusLabel } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';

const PAGE = 20;

export function ArchivedHistory() {
  const desktop = isTauriEnvironment();
  const [runs, setRuns] = useState<ArchivedRun[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef(0);

  const load = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      const list = await nativeTask<ArchivedRun[]>('task_archived_runs');
      if (id === request.current) {
        setRuns(list);
        setShown(PAGE);
      }
    } catch (cause) {
      if (id === request.current) setError(String(cause));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);

  const restore = async (run: ArchivedRun) => {
    if (busyId) return;
    setBusyId(run.id);
    setError('');
    setNotice('');
    try {
      await nativeTask('task_restore_archived', { id: run.id });
      setRuns((current) => current.filter((item) => item.id !== run.id));
      setNotice('Task restored to your loaded history.');
      await useExecutionStore.getState().refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const importRecovery = async () => {
    if (importing) return;
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const id = await nativeTask<string | null>('task_import_recovery');
      if (id) {
        setNotice('Recovery copy imported into your history.');
        await useExecutionStore.getState().refresh();
        await load();
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="mt-8" aria-label="Archived task history">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold">Archived task history</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!desktop || importing}
            onClick={() => void importRecovery()}
          >
            <Upload size={16} />
            {importing ? 'Importing…' : 'Import a recovery file…'}
          </Button>
          <Button variant="ghost" disabled={!desktop || loading} onClick={() => void load()}>
            <RefreshCw size={16} />
            {loading ? 'Reading…' : 'Refresh'}
          </Button>
        </div>
      </div>
      <p className="settings-row-description mt-3">
        Older reviewed tasks stay searchable and can be restored.
      </p>
      {error && (
        <p role="alert" className="task-error mt-4">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="task-muted mt-4">
          {notice}
        </p>
      )}
      {!error && !loading && runs.length === 0 && (
        <p className="task-muted mt-4 flex items-center gap-2">
          <Archive size={18} />
          {desktop
            ? 'No archived task history yet.'
            : 'Open the desktop app to manage archived task history.'}
        </p>
      )}
      {runs.length > 0 && (
        <>
          <ul className="mt-4 divide-y divide-[var(--color-border)]">
            {runs.slice(0, shown).map((run) => (
              <li key={run.id} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{run.prompt || 'Untitled task'}</p>
                  <p className="task-muted text-xs mt-1">
                    {run.projectName} · {run.agent} · {statusLabel[run.status] ?? run.status} ·{' '}
                    {new Date(run.endedAt ?? run.startedAt).toLocaleDateString()}
                  </p>
                </div>
                <Button variant="outline" disabled={!!busyId} onClick={() => void restore(run)}>
                  {busyId === run.id ? 'Restoring…' : 'Restore'}
                </Button>
              </li>
            ))}
          </ul>
          {shown < runs.length && (
            <Button
              variant="ghost"
              className="mt-3"
              onClick={() => setShown((count) => count + PAGE)}
            >
              Show more ({runs.length - shown} older)
            </Button>
          )}
        </>
      )}
    </section>
  );
}
