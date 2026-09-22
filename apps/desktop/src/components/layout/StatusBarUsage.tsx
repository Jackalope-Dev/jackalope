import { Popover, RefreshIcon } from '@jackalope/ui';
import { Gauge } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { capacityWindowDisplay, capacityWindowName } from '../../lib/capacity-display';
import { useCapacityStore } from '../../stores/capacityStore';
import { AgentAvatar } from '../agents/AgentAvatar';
import { Button } from '../ui/button';
import { navigateWorkspace } from './navigation';
import './statusbar-usage.css';

const agentName = (id: string) =>
  id === 'jev' ? 'TypeSafe Jev' : (getAgentMetadata(id)?.name ?? id);

function AllowanceMeter({
  remaining,
  label,
  compact = false,
}: {
  remaining: number | null;
  label: string;
  compact?: boolean;
}) {
  return (
    <span className="allowance-meter" data-unknown={remaining === null || undefined}>
      {remaining !== null && <span style={{ width: `${remaining}%` }} aria-hidden="true" />}
      {!compact && remaining !== null && (
        <meter
          className="sr-only"
          min={0}
          max={100}
          value={remaining}
          aria-label={label}
          aria-valuetext={`${remaining}% remaining`}
        />
      )}
    </span>
  );
}

export function StatusBarUsage({ remote }: { remote: boolean }) {
  const { records, loading, error, fetch } = useCapacityStore();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refreshIfVisible = () => {
      setNow(Date.now());
      if (!document.hidden) void fetch();
    };
    refreshIfVisible();
    const timer = setInterval(refreshIfVisible, 30_000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [fetch]);
  const accounts = records.filter((record) => record.status !== 'notInstalled');
  const summaries = accounts.map((record) => {
    const windows = record.windows.map((window) => ({
      ...capacityWindowDisplay(record, window, now),
      name: capacityWindowName(window),
    }));
    const limiting =
      windows.find((window) => window.remaining === null) ??
      windows.sort((a, b) => (a.remaining ?? 100) - (b.remaining ?? 100))[0];
    return { record, ...limiting };
  });
  const label = remote ? 'This computer’s quota' : 'Usage & quota';
  const refresh = () => {
    setNow(Date.now());
    void fetch(true);
  };
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) {
          setNow(Date.now());
          void fetch();
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="statusbar-usage"
          aria-label={[
            label,
            ...summaries.map(
              (summary) => `${agentName(summary.record.agent)}: ${summary.label ?? 'Not reported'}`,
            ),
          ].join(', ')}
        >
          <Gauge size={15} aria-hidden="true" />
          <span className="statusbar-usage-label">{label}</span>
          {summaries.slice(0, 2).map((summary) => (
            <span
              key={summary.record.agent}
              className="statusbar-quota"
              data-tone={summary.tone ?? 'unknown'}
              title={`${agentName(summary.record.agent)} · ${summary.name ?? 'Account allowance'} · ${summary.label ?? 'Not reported'}`}
            >
              <AgentAvatar provider={summary.record.agent} size="xs" />
              <span className="statusbar-quota-readout">
                <span>
                  {summary.remaining == null
                    ? '—'
                    : `${summary.remaining.toLocaleString(undefined, { maximumFractionDigits: summary.remaining < 10 ? 1 : 0 })}%`}
                </span>
                <AllowanceMeter remaining={summary.remaining ?? null} label="" compact />
              </span>
            </span>
          ))}
          {summaries.length > 2 && (
            <span className="statusbar-quota-more">+{summaries.length - 2}</span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="statusbar-allowances"
          side="top"
          align="end"
          collisionPadding={12}
          aria-label={label}
        >
          <header className="statusbar-allowances-heading">
            <div>
              <h2>{label}</h2>
              <p>Remaining account allowances</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh account allowances"
              disabled={loading}
              onClick={refresh}
            >
              <RefreshIcon size={16} />
            </Button>
          </header>
          {loading && <p role="status">Checking account allowances…</p>}
          {error && <p role="alert">{error}</p>}
          {accounts.map((record) => (
            <section
              className="statusbar-allowance-account"
              key={record.agent}
              aria-label={agentName(record.agent)}
            >
              <header>
                <AgentAvatar provider={record.agent} size="sm" />
                <div>
                  <h3>{agentName(record.agent)}</h3>
                  <p>{record.account || 'Account unknown'}</p>
                </div>
              </header>
              {record.windows.map((window) => {
                const { remaining, label, tone } = capacityWindowDisplay(record, window, now);
                const name = capacityWindowName(window);
                const resets = window.resetsAt === null ? null : new Date(window.resetsAt * 1000);
                const expired = resets !== null && resets.getTime() <= now;
                return (
                  <div
                    className="statusbar-allowance-window"
                    data-tone={tone}
                    key={`${window.poolId}:${window.window}`}
                  >
                    <div className="statusbar-allowance-label">
                      <span>{name}</span>
                      <strong>{label}</strong>
                    </div>
                    <AllowanceMeter
                      remaining={remaining}
                      label={`${agentName(record.agent)} · ${window.poolName} · ${name}`}
                    />
                    <div className="statusbar-allowance-caption">
                      <span>{window.poolName}</span>
                      <span>
                        {expired
                          ? 'Window ended'
                          : resets
                            ? `Resets ${resets.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                            : 'Reset time not reported'}
                      </span>
                    </div>
                  </div>
                );
              })}
              {!record.windows.length && (
                <p className="statusbar-allowance-empty">{record.detail || 'Usage unavailable'}</p>
              )}
            </section>
          ))}
          {!accounts.length && !loading && (
            <p className="statusbar-allowance-empty">
              No account allowance available. Connect an agent, then refresh.
            </p>
          )}
          <footer>
            <p>Shared with other apps using these accounts.</p>
            <Popover.Close asChild>
              <Button variant="outline" onClick={() => navigateWorkspace('usage')}>
                View usage
              </Button>
            </Popover.Close>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
