import { Badge, Disclosure, DisclosureSummary, Panel, RefreshIcon } from '@jackalope/ui';

import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { type CapacityWindow, useCapacityStore } from '../../stores/capacityStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import './capacity-panel.css';

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
  const { records, loading, error, lastFetched, fetch } = useCapacityStore();
  const [now, setNow] = useState(Date.now());
  const nextRefresh = lastFetched ? lastFetched + 60_000 : 0;
  const refresh = () => void fetch(true);
  useEffect(() => {
    const refreshIfVisible = () => {
      if (isTauriEnvironment() && document.visibilityState === 'visible') void fetch();
    };
    refreshIfVisible();
    const interval = setInterval(refreshIfVisible, 60_000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [fetch]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="capacity-panel" aria-labelledby="capacity-title">
      <WorkspaceSectionHeading
        title="Account quota"
        titleId="capacity-title"
        description="Shared with other apps using these accounts."
        action={
          <Button
            variant="outline"
            onClick={refresh}
            disabled={loading || now < nextRefresh || !isTauriEnvironment()}
            loading={loading}
            loadingLabel="Checking…"
          >
            <RefreshIcon size={16} />
            Refresh limits
          </Button>
        }
      />
      {error && (
        <InlineNotice tone="error" className="mt-3">
          {error}
        </InlineNotice>
      )}
      {loading && (
        <LoadingState
          label={records.length ? 'Updating account limits…' : 'Reading available account limits…'}
          compact={records.length > 0}
        />
      )}
      {!records.length && !loading && (
        <p className="task-muted text-sm mt-4">
          {isTauriEnvironment()
            ? 'No account limits were reported. Sign in to an agent, then refresh.'
            : 'Account limits are available in the desktop app.'}
        </p>
      )}
      <div className="capacity-connections">
        {records.map((record) => {
          const stale =
            record.status === 'stale' ||
            Boolean(record.observedAt && now - Date.parse(record.observedAt) > 300_000);
          return (
            <Panel className="capacity-connection" key={record.agent}>
              <div className="capacity-identity">
                <div>
                  <h3>{names[record.agent] ?? record.agent}</h3>
                  <p className="task-muted text-xs">{record.account}</p>
                </div>
                {stale && <Badge variant="warning">Stale</Badge>}
              </div>
              <div className="capacity-measurement">
                {record.windows.length ? (
                  <div className="capacity-windows">
                    {record.windows.map((window) => {
                      const expired = window.resetsAt != null && window.resetsAt * 1000 <= now;
                      const outdated = stale || expired;
                      const remaining = window.remainingPercent;
                      return (
                        <div
                          className="capacity-window"
                          data-low={!outdated && remaining != null && remaining <= 20}
                          key={`${window.poolId}:${window.window}`}
                        >
                          <div className="capacity-window-label">
                            <span>{windowName(window)}</span>
                            {!outdated && remaining != null && remaining <= 20 && (
                              <Badge variant="warning">
                                {remaining === 0 ? 'Limit reached' : 'Running low'}
                              </Badge>
                            )}
                          </div>
                          <p className="capacity-remaining" data-unavailable={remaining == null}>
                            {remaining == null ? (
                              'Unavailable'
                            ) : (
                              <>
                                <strong>
                                  {remaining.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                  })}
                                  <span>%</span>
                                </strong>
                                <span>{outdated ? 'last reported' : 'remaining'}</span>
                              </>
                            )}
                          </p>
                          {remaining != null && !outdated ? (
                            <meter
                              min={0}
                              max={100}
                              value={remaining}
                              aria-label={`${names[record.agent] ?? record.agent} ${window.poolName} ${windowName(window)} remaining`}
                            />
                          ) : (
                            <div className="capacity-unknown-track" aria-hidden="true" />
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
                  <div className="capacity-unavailable">
                    <p>
                      {record.status === 'notInstalled' ? 'Not installed' : 'Balance unavailable'}
                    </p>
                    <p className="capacity-detail">{record.detail}</p>
                  </div>
                )}
                {(record.windows.length > 0 || record.observedAt) && (
                  <Disclosure className="capacity-details">
                    <DisclosureSummary>Reporting details</DisclosureSummary>
                    {record.windows.length > 0 && (
                      <p className="task-muted text-xs capacity-detail">{record.detail}</p>
                    )}
                    {record.observedAt && (
                      <p className="task-muted text-xs capacity-source">
                        {stale ? 'Stale snapshot' : 'Snapshot'} ·{' '}
                        {new Date(record.observedAt).toLocaleTimeString()} · {record.source}
                      </p>
                    )}
                  </Disclosure>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
      {nextRefresh > now && !loading && (
        <p className="task-muted text-xs mt-3">
          Refresh available in {Math.ceil((nextRefresh - now) / 1000)}s.
        </p>
      )}
    </section>
  );
}
