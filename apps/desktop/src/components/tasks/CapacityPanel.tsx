import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Badge, Panel, RefreshIcon } from '@jackalope/ui';

import { useEffect, useState } from 'react';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { type CapacityWindow, useCapacityStore } from '../../stores/capacityStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import './capacity-panel.css';

const agentName = (agent: string) => getAgentMetadata(agent)?.name ?? agent;
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

const windowExpired = (window: CapacityWindow, now: number) =>
  window.resetsAt != null && window.resetsAt * 1000 <= now;
/** Single-line reset text; the tiles ellipsize, so the full wording lives in `resetDetail`. */
function resetLabel(window: CapacityWindow, now: number) {
  if (windowExpired(window, now)) return 'Window ended';
  if (window.resetsAt == null) return 'Reset time not reported';
  return `Resets ${new Date(window.resetsAt * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}
const resetDetail = (window: CapacityWindow, now: number) =>
  windowExpired(window, now)
    ? 'Window ended; refresh for current capacity'
    : resetLabel(window, now);

const GAUGE_RADIUS = 32;
const GAUGE_LENGTH = 2 * Math.PI * GAUGE_RADIUS;
const percentLabel = (remaining: number) =>
  remaining >= 10
    ? String(Math.round(remaining))
    : remaining.toLocaleString(undefined, { maximumFractionDigits: 1 });

/**
 * Radial remaining-capacity dial; the ring stays unfilled when the balance is unknown. The ring is
 * decorative, so the percentage stays readable text and the dial labels carry the rest.
 */
function CapacityGauge({ remaining }: { remaining: number | null }) {
  const clamped = remaining == null ? null : Math.min(100, Math.max(0, remaining));
  return (
    <span className="capacity-gauge">
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle className="capacity-gauge-track" cx="40" cy="40" r={GAUGE_RADIUS} />
        {clamped != null && (
          <circle
            className="capacity-gauge-value"
            cx="40"
            cy="40"
            r={GAUGE_RADIUS}
            strokeDasharray={GAUGE_LENGTH}
            strokeDashoffset={GAUGE_LENGTH * (1 - clamped / 100)}
          />
        )}
      </svg>
      <span className="capacity-gauge-readout">
        {clamped == null ? (
          <span className="capacity-gauge-unknown">n/a</span>
        ) : (
          <>
            <strong>{percentLabel(clamped)}</strong>
            <span>%</span>
          </>
        )}
      </span>
    </span>
  );
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
    <section
      className="capacity-panel workspace-section workspace-stack"
      aria-labelledby="capacity-title"
    >
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
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {loading && (
        <LoadingState
          label={records.length ? 'Updating account limits…' : 'Reading available account limits…'}
          compact={records.length > 0}
        />
      )}
      {!records.length && !loading && (
        <p className="task-muted text-sm">
          {isTauriEnvironment()
            ? 'No account limits were reported. Sign in to an agent, then refresh.'
            : 'Account limits are available in the desktop app.'}
        </p>
      )}
      {records.length > 0 && (
        <div className="capacity-connections workspace-card-grid">
          {records.map((record) => {
            const stale =
              record.status === 'stale' ||
              Boolean(record.observedAt && now - Date.parse(record.observedAt) > 300_000);
            const name = agentName(record.agent);
            return (
              <Panel className="capacity-card" key={record.agent}>
                <header className="capacity-card-head">
                  <span className="capacity-agent-mark" aria-hidden="true">
                    <AgentCharacter provider={record.agent} />
                  </span>
                  <div className="capacity-card-identity">
                    <h3>{name}</h3>
                    <p className="task-muted text-xs" title={record.account}>
                      {record.account}
                    </p>
                  </div>
                  {stale && <Badge variant="warning">Stale</Badge>}
                </header>
                {record.windows.length ? (
                  <div className="capacity-dials">
                    {record.windows.map((window) => {
                      const outdated = stale || windowExpired(window, now);
                      const remaining = window.remainingPercent;
                      const low = !outdated && remaining != null && remaining <= 20;
                      return (
                        <div
                          className="capacity-dial"
                          data-tone={
                            remaining == null ? 'unknown' : outdated ? 'stale' : low ? 'low' : 'ok'
                          }
                          key={`${window.poolId}:${window.window}`}
                        >
                          <CapacityGauge remaining={remaining} />
                          <div className="capacity-dial-meta">
                            <span className="capacity-dial-name">
                              <span>{windowName(window)}</span>
                              {low && (
                                <Badge variant="warning">
                                  {remaining === 0 ? 'Limit reached' : 'Low'}
                                </Badge>
                              )}
                            </span>
                            <span className="capacity-dial-line">
                              {remaining == null
                                ? 'Balance unavailable'
                                : outdated
                                  ? 'Last reported'
                                  : 'Remaining'}{' '}
                              · {window.poolName}
                            </span>
                            <span className="capacity-dial-line" title={resetDetail(window, now)}>
                              {resetLabel(window, now)}
                            </span>
                          </div>
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
              </Panel>
            );
          })}
        </div>
      )}
      {nextRefresh > now && !loading && (
        <p className="task-muted text-xs">
          Refresh available in {Math.ceil((nextRefresh - now) / 1000)}s.
        </p>
      )}
    </section>
  );
}
