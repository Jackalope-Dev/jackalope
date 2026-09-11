import { Badge, Disclosure, DisclosureBody, DisclosureSummary, Panel, Stat } from '@jackalope/ui';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { UsageInsights as Insights } from '../../lib/usage-insights';
import { Button } from '../ui/button';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import './usage-insights.css';

export const tokenLabel = (tokens: number | null) =>
  tokens === null ? 'Unavailable' : tokens.toLocaleString();
const compact = (tokens: number) =>
  Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);

export function UsageInsights({
  data,
  scope,
  selectedDate,
  onProject,
  onAgent,
  onDate,
}: {
  data: Insights;
  scope: string;
  selectedDate?: string | null;
  onProject: (id: string) => void;
  onAgent: (id: string) => void;
  onDate: (date: string) => void;
}) {
  const chart = useRef<HTMLDivElement>(null);
  const lastDate = data.trend.at(-1)?.date;
  useEffect(() => {
    if (lastDate && chart.current) chart.current.scrollLeft = chart.current.scrollWidth;
  }, [lastDate]);
  const max = Math.max(1, ...data.trend.map((p) => p.tokens ?? 0));
  const attribution = [
    {
      title: 'Task execution',
      stats: data.worker,
      kind: 'worker',
      description: 'Agent work, context, tools and in-task checks.',
    },
    {
      title: 'Quota-interrupted work',
      stats: data.handoffs,
      kind: 'handoff',
      description: 'Worker usage before switching accounts or agents.',
    },
    {
      title: 'Agent selection',
      stats: data.routing,
      kind: 'routing',
      description: 'Model calls to choose an agent, including failed selections.',
    },
  ];
  return (
    <div className="usage-insights">
      <Panel className="usage-summary" aria-label={`${scope} usage summary`}>
        <div className="usage-scope-heading">
          <span>{scope}</span>
          {data.total.missing > 0 && <Badge variant="warning">Partial reporting</Badge>}
        </div>
        <div className="usage-metrics">
          <Stat
            label="Reported tokens"
            value={tokenLabel(data.total.tokens)}
            description={`${data.total.reported} of ${data.total.calls} calls reported usage`}
          />
          <Stat
            label="Tasks with activity"
            value={data.tasks.length}
            description={`${data.projects.length} projects · ${data.agents.length} agents`}
          />
          <Stat
            label="Accepted by you"
            value={
              <>
                {data.accepted}
                <small> / {data.tasks.length}</small>
              </>
            }
            description={`${data.changes} need changes · ${data.tasks.length - data.accepted - data.changes} without a complete decision`}
          />
        </div>
      </Panel>
      <Panel className="usage-trend" aria-labelledby="usage-trend-title">
        <WorkspaceSectionHeading
          level={3}
          titleId="usage-trend-title"
          title="Usage over time"
          description="Select a bar to explore its calls."
          action={
            <div className="usage-chart-legend">
              <span>
                <i className="usage-legend-swatch" data-kind="worker" />
                Worker usage
              </span>
              <span>
                <i className="usage-legend-swatch" data-kind="routing" />
                Agent selection
              </span>
            </div>
          }
        />
        <div className="usage-chart-frame">
          <div className="usage-chart-axis" aria-hidden="true">
            <span>{compact(max)}</span>
            <span>{compact(max / 2)}</span>
            <span>0</span>
          </div>
          <div className="usage-chart-scroll" ref={chart}>
            <div
              className="usage-chart"
              style={{ minWidth: Math.max(320, data.trend.length * 46) }}
            >
              {data.trend.map((point) => (
                <button
                  key={point.date}
                  type="button"
                  className="usage-chart-point"
                  aria-pressed={selectedDate === point.date}
                  onClick={() => onDate(point.date)}
                  aria-label={`${point.date}: ${tokenLabel(point.tokens)} reported tokens, ${tokenLabel(point.routing)} routing tokens, ${point.missing} missing reports. Inspect calls.`}
                >
                  <span className="usage-chart-value">
                    {point.tokens === null ? '—' : compact(point.tokens)}
                  </span>
                  <span className="usage-chart-track" aria-hidden="true">
                    <span
                      className="usage-chart-fill"
                      style={{ height: `${((point.tokens ?? 0) / max) * 100}%` }}
                    >
                      <span
                        className="usage-chart-routing"
                        style={{
                          height: `${point.tokens ? ((point.routing ?? 0) / point.tokens) * 100 : 0}%`,
                        }}
                      />
                    </span>
                    {point.missing > 0 && <span className="usage-chart-missing">?</span>}
                  </span>
                  <span className="usage-chart-date">
                    {point.date.length === 10 ? point.date.slice(5) : point.date}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <Disclosure className="usage-chart-details">
          <DisclosureSummary>
            About this chart
            {data.total.missing > 0 ? ` · ${data.total.missing} missing reports` : ''}
          </DisclosureSummary>
          <DisclosureBody>
            <p className="task-muted">
              Workers use attempt start dates; routing and quota handoffs use their recorded dates,
              in your local time. Shaded caps show agent selection; ? marks missing reports. Cached
              input is counted once. This is not subscription quota or a monetary bill.
            </p>
          </DisclosureBody>
        </Disclosure>
      </Panel>
      <Panel className="usage-attribution" aria-labelledby="usage-attribution-title">
        <WorkspaceSectionHeading
          level={3}
          titleId="usage-attribution-title"
          title="Where the tokens went"
        />
        <div className="usage-attribution-bar" aria-hidden="true">
          {attribution.map(({ kind, stats }) => (
            <span
              key={kind}
              data-kind={kind}
              style={{
                width: `${data.total.tokens ? ((stats.tokens ?? 0) / data.total.tokens) * 100 : 0}%`,
              }}
            />
          ))}
        </div>
        <div className="usage-attribution-grid">
          {attribution.map(({ title, stats, kind, description }) => {
            return (
              <div key={title}>
                <h4>
                  <span className="usage-legend-swatch" data-kind={kind} aria-hidden="true" />
                  {title}
                </h4>
                <strong>{tokenLabel(stats.tokens)}</strong>
                <span className="task-muted"> tokens{stats.missing ? ' · partial' : ''}</span>
                <p>{description}</p>
              </div>
            );
          })}
        </div>
        <p className="usage-attribution-note">
          {data.routingPercent === null
            ? data.total.missing
              ? 'The routing share is unavailable until every call reports usage.'
              : 'No nonzero reported tokens to calculate a routing share.'
            : `${data.routingPercent.toFixed(1)}% of reported task tokens went to agent selection.`}{' '}
          Prompt and coordination overhead inside worker calls is included in task execution; its
          exact token share is unavailable.
        </p>
      </Panel>
      <section
        className="usage-outcomes workspace-section workspace-stack"
        aria-label="Usage by outcome"
      >
        <WorkspaceSectionHeading
          level={3}
          title="Usage by outcome"
          description="Tokens spent in this view, grouped by each task’s latest saved review."
        />
        <div className="usage-outcome-grid">
          {data.outcomes.map((outcome) => (
            <div key={outcome.label}>
              <h4>{outcome.label}</h4>
              <strong>{tokenLabel(outcome.tokens)}</strong>
              <p>
                {outcome.tasks} tasks
                {outcome.missing ? ` · ${outcome.missing} missing reports` : ''}
              </p>
              <span className="usage-rank-track" aria-hidden="true">
                <span
                  style={{
                    width: `${data.total.tokens ? ((outcome.tokens ?? 0) / data.total.tokens) * 100 : 0}%`,
                  }}
                />
              </span>
            </div>
          ))}
        </div>
      </section>
      <div className="usage-ranking-grid">
        <UsageRanking title="By project" rows={data.projects} onSelect={onProject} projects />
        <UsageRanking title="By agent" rows={data.agents} onSelect={onAgent} />
      </div>
      <p className="task-muted">
        Accepted means the latest saved outcome review accepted the task’s requirements. It
        describes that reviewed snapshot, not the current files. Usage includes all calls in the
        selected filters, including failed and repeated attempts.
      </p>
    </div>
  );
}

function UsageRanking({
  title,
  rows,
  onSelect,
  projects = false,
}: {
  title: string;
  rows: Insights['projects'];
  onSelect: (id: string) => void;
  projects?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.tokens ?? 0));
  return (
    <section className="usage-ranking" aria-label={title}>
      <WorkspaceSectionHeading level={3} title={title} />
      {rows.slice(0, 8).map((row) => (
        <Button
          variant="ghost"
          key={row.id}
          className="usage-rank-row"
          onClick={() => onSelect(row.id)}
        >
          <span className="usage-rank-label">
            <span>{row.label}</span>
            <small>
              {row.tasks} tasks{projects ? ` · ${row.accepted} accepted` : ''}
              {row.missing ? ` · ${row.missing} missing reports` : ''}
            </small>
            <span className="usage-rank-track" aria-hidden="true">
              <span style={{ width: `${((row.tokens ?? 0) / max) * 100}%` }} />
            </span>
          </span>
          <span>
            {tokenLabel(row.tokens)}
            <small> tokens</small>
          </span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </Button>
      ))}
      {rows.length > 8 && (
        <p className="task-muted">Top 8 of {rows.length}; use the filters to inspect the rest.</p>
      )}
    </section>
  );
}
