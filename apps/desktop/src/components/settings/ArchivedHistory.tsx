import { statusLabel } from '@jackalope/contracts/runs';
import {
  Button,
  RefreshIcon,
  SettingActions,
  SettingBody,
  SettingGroup,
  SettingRow,
} from '@jackalope/ui';
import { Archive, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../lib/errors';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import type { ArchivedRun } from '../../lib/run-types';
import { restoreArchivedTask } from '../../lib/task-client';
import { useExecutionStore } from '../../stores/executionStore';
import { ActionError } from '../ui/ActionError';

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
      const list = await invokeNative<ArchivedRun[]>('task_archived_runs');
      if (id === request.current) {
        setRuns(list);
        setShown(PAGE);
      }
    } catch (cause) {
      if (id === request.current) setError(describeError(cause));
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
      await restoreArchivedTask(run.id);
      setRuns((current) => current.filter((item) => item.id !== run.id));
      setNotice('Task restored to your loaded history.');
      await useExecutionStore.getState().refresh();
    } catch (cause) {
      setError(describeError(cause));
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
      const id = await invokeNative<string | null>('task_import_recovery');
      if (id) {
        setNotice('Recovery copy imported into your history.');
        await useExecutionStore.getState().refresh();
        await load();
      }
    } catch (cause) {
      setError(describeError(cause));
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
          <ActionError error={error} />
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
        <SettingRow
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
        </SettingRow>
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
