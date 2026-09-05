import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import './capacity-panel.css';

interface CapacityWindow {
  poolId: string;
  poolName: string;
  window: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  durationMinutes: number | null;
  resetsAt: number | null;
}
interface CapacityRecord {
  agent: string;
  status: string;
  account: string;
  source: string;
  observedAt: string | null;
  detail: string;
  windows: CapacityWindow[];
}

const names: Record<string, string> = { codex: 'Codex', claude: 'Claude Code', grok: 'Grok' };
function windowName(window: CapacityWindow) {
  if (window.window === 'weekly') return 'Weekly allowance';
  if (window.window === 'monthly') return 'Monthly allowance';
  if (window.window === 'billing') return 'Included allowance';
  const minutes = window.durationMinutes;
  if (!minutes) {
    if (window.window === 'primary') return 'Primary window';
    if (window.window === 'secondary') return 'Secondary window';
    return 'Usage window';
  }
  if (minutes % 1440 === 0) return `${minutes / 1440}-day window`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
  return `${minutes}-minute window`;
}

export function CapacityPanel() {
  const [records, setRecords] = useState<CapacityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [nextRefresh, setNextRefresh] = useState(0);
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await nativeTask<CapacityRecord[]>('capacity_snapshot', { refresh: true }));
      setNextRefresh(Date.now() + 60_000);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setNow(Date.now());
      setLoading(false);
    }
  };
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="capacity-panel" aria-labelledby="capacity-title">
      <div className="capacity-heading">
        <div>
          <h2 id="capacity-title">Connected capacity</h2>
          <p className="task-muted">Remaining account limits · independent of the filters above.</p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={loading || now < nextRefresh || !isTauriEnvironment()}
        >
          <RefreshCw size={14} />
          {loading ? 'Checking…' : 'Refresh capacity'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="task-error mt-3">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="task-muted text-sm mt-3">
          Reading available account limits…
        </p>
      )}
      {!records.length && !loading && (
        <p className="task-muted text-sm mt-4">
          {isTauriEnvironment()
            ? 'Refresh to check limits from your signed-in agents.'
            : 'Account limits are available in the desktop app.'}
        </p>
      )}
      <div className="capacity-connections">
        {records.map((record) => {
          const stale =
            record.status === 'stale' ||
            Boolean(record.observedAt && now - Date.parse(record.observedAt) > 300_000);
          return (
            <div className="capacity-connection" key={record.agent}>
              <div className="capacity-identity">
                <h3>{names[record.agent] ?? record.agent}</h3>
                <span className="task-muted text-xs">{record.account}</span>
              </div>
              <div className="capacity-measurement">
                {record.windows.length ? (
                  <div className="capacity-windows">
                    {record.windows.map((window) => {
                      const expired = window.resetsAt != null && window.resetsAt * 1000 <= now;
                      const outdated = stale || expired;
                      return (
                        <div className="capacity-window" key={`${window.poolId}:${window.window}`}>
                          <div className="capacity-window-label">
                            <span>{windowName(window)}</span>
                            <span className="capacity-remaining">
                              {window.remainingPercent == null
                                ? 'Unavailable'
                                : `${window.remainingPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% ${outdated ? 'last reported' : 'remaining'}`}
                            </span>
                          </div>
                          {window.remainingPercent != null && !outdated && (
                            <meter
                              min={0}
                              max={100}
                              value={window.remainingPercent}
                              aria-label={`${names[record.agent]} ${window.poolName} ${windowName(window)} remaining`}
                            />
                          )}
                          <p className="task-muted text-xs">
                            {window.poolName} ·{' '}
                            {expired
                              ? 'Window ended; refresh for current capacity'
                              : window.resetsAt
                                ? `Resets ${new Date(window.resetsAt * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                                : 'Reset time not reported'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="capacity-unavailable">
                    {record.status === 'notInstalled' ? 'Not installed' : 'Balance unavailable'}
                  </p>
                )}
                <p className="task-muted text-xs capacity-detail">{record.detail}</p>
                {record.observedAt && (
                  <p className="task-muted text-xs capacity-source">
                    {stale ? 'Stale snapshot' : 'Snapshot'} ·{' '}
                    {new Date(record.observedAt).toLocaleTimeString()} · {record.source}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {nextRefresh > now && !loading && (
        <p className="task-muted text-xs mt-3">
          Refresh available in {Math.ceil((nextRefresh - now) / 1000)}s.
        </p>
      )}
      <details className="supporting-details">
        <summary>About account limits</summary>
        <p>
          Includes work outside Jackalope. Missing or stale snapshots cannot establish available
          budget.
        </p>
      </details>
    </section>
  );
}
