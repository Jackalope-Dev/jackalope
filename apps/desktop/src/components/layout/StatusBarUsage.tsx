import { Button, Popover, RefreshIcon, Tooltip } from '@jackalope/ui';
import { Gauge } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { navigateWorkspace } from '../../lib/app-events';
import { capacityWindowDisplay, capacityWindowName } from '../../lib/capacity-display';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useCapacityStore } from '../../stores/capacityStore';
import { useExecutionStore } from '../../stores/executionStore';
import {
  isAgentAllowedForProject,
  useActiveProject,
  useProjectStore,
} from '../../stores/projectStore';
import { ProviderMark } from '../agents/ProviderMark';
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

/** Time until a window resets, in its largest whole unit: "in 3h", "in 2d". */
function resetsIn(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function StatusBarUsage({ remote }: { remote: boolean }) {
  const { records, loading, error, fetch } = useCapacityStore(
    useShallow((s) => ({ records: s.records, loading: s.loading, error: s.error, fetch: s.fetch })),
  );
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
  const projectId = useProjectStore((state) => state.activeProjectId);
  const project = useActiveProject();
  const enabledAgents = useAgentConfigStore((state) => state.enabledAgents);
  const runs = useExecutionStore((state) => state.runs);
  const projectAgents = new Set(
    runs.filter((run) => run.projectId === projectId).map((run) => run.agent),
  );
  const isAgentEnabled = (agentId: string) =>
    (enabledAgents[agentId] ?? true) &&
    (!projectId || (Boolean(project) && isAgentAllowedForProject(project, agentId)));
  // Only agents enabled on the current project that report allowance data or have run in this project.
  const accounts = records.filter(
    (record) =>
      record.status !== 'notInstalled' &&
      isAgentEnabled(record.agent) &&
      (record.windows.length > 0 || projectAgents.has(record.agent)),
  );
  const summaries = accounts.map((record) => {
    const windows = record.windows.map((window) => ({
      ...capacityWindowDisplay(record, window, now),
      name: capacityWindowName(window),
      resetsAt: window.resetsAt,
    }));
    const limiting =
      windows.find((window) => window.remaining === null) ??
      windows.sort((a, b) => (a.remaining ?? 100) - (b.remaining ?? 100))[0];
    return { record, ...limiting };
  });
  // What each meter measures: the agent's most limiting allowance window and when it resets.
  const describe = (summary: (typeof summaries)[number]) => {
    const agent = agentName(summary.record.agent);
    if (summary.remaining == null) return `${agent}: ${summary.label ?? 'Not reported'}`;
    const window = (summary.name ?? 'account allowance').toLowerCase();
    const resets =
      summary.resetsAt != null && summary.resetsAt * 1000 > now
        ? `, resets ${resetsIn(summary.resetsAt * 1000 - now)}`
        : '';
    return `${agent}: ${summary.label} in the ${window}${resets}`;
  };
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
      <Tooltip
        side="top"
        content={
          summaries.length ? (
            <span className="statusbar-usage-tooltip">
              {summaries.map((summary) => (
                <span key={summary.record.agent}>{describe(summary)}</span>
              ))}
            </span>
          ) : (
            label
          )
        }
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className="statusbar-usage"
            aria-label={[label, ...summaries.map(describe)].join('. ')}
          >
            <Gauge size={15} aria-hidden="true" />
            {!summaries.length && <span className="statusbar-usage-label">{label}</span>}
            {summaries.slice(0, 2).map((summary) => (
              <span
                key={summary.record.agent}
                className="statusbar-quota"
                data-tone={summary.tone ?? 'unknown'}
              >
                <ProviderMark provider={summary.record.agent} size={16} />
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
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className="statusbar-allowances"
          side="top"
          align="end"
          collisionPadding={12}
          aria-label={label}
        >
          <header className="statusbar-allowances-heading">
            <h2>{label}</h2>
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
          {accounts.map((record) => {
            // The first pool is the plan itself; only further pools (such as one model's
            // own allowance) need their name to tell windows apart.
            const mainPool = record.windows[0]?.poolId;
            return (
              <section
                className="statusbar-allowance-account"
                key={record.agent}
                aria-label={agentName(record.agent)}
              >
                <header>
                  <ProviderMark provider={record.agent} size={16} />
                  <h3>{agentName(record.agent)}</h3>
                  {record.account && (
                    <span className="statusbar-allowance-login">{record.account}</span>
                  )}
                </header>
                {record.windows.map((window) => {
                  const { remaining, label, tone } = capacityWindowDisplay(record, window, now);
                  const name = capacityWindowName(window).replace(/ (window|allowance)$/, '');
                  const resets = window.resetsAt === null ? null : new Date(window.resetsAt * 1000);
                  const expired = resets !== null && resets.getTime() <= now;
                  return (
                    <div
                      className="statusbar-allowance-window"
                      data-tone={tone}
                      key={`${window.poolId}:${window.window}`}
                    >
                      <span className="statusbar-allowance-name">
                        {window.poolId === mainPool ? name : `${window.poolName} · ${name}`}
                      </span>
                      <AllowanceMeter
                        remaining={remaining}
                        label={`${agentName(record.agent)} · ${window.poolName} · ${name}`}
                      />
                      {/* The column fits a percentage; other states keep their full wording on hover. */}
                      <strong title={label}>
                        {remaining !== null
                          ? `${label.split(' ')[0]} left`
                          : label === 'Refresh needed'
                            ? 'Refresh'
                            : '—'}
                      </strong>
                      <span
                        className="statusbar-allowance-reset"
                        title={
                          resets
                            ? `Resets ${resets.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                            : 'Reset time not reported'
                        }
                      >
                        {expired ? 'Ended' : resets ? resetsIn(resets.getTime() - now) : '—'}
                      </span>
                    </div>
                  );
                })}
                {!record.windows.length && (
                  <p className="statusbar-allowance-empty">
                    {record.detail || 'Usage unavailable'}
                  </p>
                )}
              </section>
            );
          })}
          {!accounts.length && !loading && (
            <p className="statusbar-allowance-empty">
              No account allowance available. Connect an agent, then refresh.
            </p>
          )}
          <footer>
            <p>Shared with other apps using these accounts.</p>
            <Popover.Close asChild>
              <Button variant="outline" size="sm" onClick={() => navigateWorkspace('usage')}>
                View usage
              </Button>
            </Popover.Close>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
