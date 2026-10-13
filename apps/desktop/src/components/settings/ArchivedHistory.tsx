import { RefreshIcon } from '@jackalope/ui';
import { Archive, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ArchivedRun, nativeTask, statusLabel } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { Setting, SettingActions, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

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
    <SettingGroup
      aria-label="Archived task history"
      title="Archived task history"
      action={
        <div className="workspace-actions">
          <Button
            variant="outline"
            disabled={!desktop || importing}
            onClick={() => void importRecovery()}
            loading={importing}
            loadingLabel="Importing…"
          >
            <Upload size={16} />
            Import a recovery file…
          </Button>
          <Button
            variant="ghost"
            disabled={!desktop || loading}
            onClick={() => void load()}
            loading={loading}
            loadingLabel="Reading…"
          >
            <RefreshIcon size={16} />
            Refresh
          </Button>
        </div>
      }
    >
      {(error || notice || (!loading && runs.length === 0)) && (
        <SettingBody>
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          {notice && (
            <p role="status" className="task-muted">
              {notice}
            </p>
          )}
          {!error && !loading && runs.length === 0 && (
            <p className="task-muted flex items-center gap-2">
              <Archive size={18} />
              {desktop
                ? 'No archived task history yet.'
                : 'Open the desktop app to manage archived task history.'}
            </p>
          )}
        </SettingBody>
      )}
      {runs.slice(0, shown).map((run) => (
        <Setting
          key={run.id}
          title={<span className="block truncate">{run.prompt || 'Untitled task'}</span>}
          description={`${run.projectName} · ${run.agent} · ${statusLabel[run.status] ?? run.status} · ${new Date(
            run.endedAt ?? run.startedAt,
          ).toLocaleDateString()}`}
        >
          <Button
            variant="outline"
            disabled={!!busyId}
            onClick={() => void restore(run)}
            loading={busyId === run.id}
            loadingLabel="Restoring…"
          >
            Restore
          </Button>
        </Setting>
      ))}
      {shown < runs.length && (
        <SettingActions>
          <Button variant="ghost" onClick={() => setShown((count) => count + PAGE)}>
            Show more ({runs.length - shown} older)
          </Button>
        </SettingActions>
      )}
    </SettingGroup>
  );
}
