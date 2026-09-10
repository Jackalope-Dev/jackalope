import { useEffect, useRef } from 'react';
import type { UsageInsights as Insights } from '../../lib/usage-insights';
import { Button } from '../ui/button';
import './usage-insights.css';

export const tokenLabel = (tokens: number | null) =>
  tokens === null ? 'Unavailable' : tokens.toLocaleString();
const compact = (tokens: number) =>
  Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);

export function UsageInsights({
  data,
  scope,
  onProject,
  onAgent,
  onDate,
}: {
  data: Insights;
  scope: string;
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
  return (
    <div className="usage-insights">
      <div className="usage-scope-heading">
        <h2>{scope}</h2>
        <span className="task-muted">Task activity · loaded history</span>
      </div>
      <dl className="usage-metrics">
        <div>
          <dt>Reported tokens</dt>
          <dd>{tokenLabel(data.total.tokens)}</dd>
          <p>
            {data.total.reported} of {data.total.calls} calls reported usage
            {data.total.missing ? ' · partial total' : ''}
          </p>
        </div>
        <div>
          <dt>Tasks with activity</dt>
          <dd>{data.tasks.length}</dd>
          <p>
            {data.projects.length} projects · {data.agents.length} agents
          </p>
        </div>
        <div>
          <dt>Accepted by you</dt>
          <dd>
            {data.accepted}
            <small> / {data.tasks.length}</small>
          </dd>
          <p>
            {data.changes} need changes · {data.tasks.length - data.accepted - data.changes} without
            a complete decision
          </p>
        </div>
      </dl>
      <section className="usage-attribution" aria-labelledby="usage-attribution-title">
        <h3 id="usage-attribution-title">Where the tokens went</h3>
        <div className="usage-attribution-grid">
          {[
            ['Task execution', data.worker, 'Agent work, context, tools and in-task checks.'],
            [
              'Quota-interrupted work',
              data.handoffs,
              'Worker usage before switching to another account or agent.',
            ],
            [
              'Agent selection overhead',
              data.routing,
              'Model calls Jackalope made to choose an agent, including failed selections.',
            ],
          ].map(([title, value, description]) => {
            const stats = value as Insights['total'];
            return (
              <div key={String(title)}>
                <h4>{String(title)}</h4>
                <strong>{tokenLabel(stats.tokens)}</strong>
                <span className="task-muted"> tokens{stats.missing ? ' · partial' : ''}</span>
                <p>{String(description)}</p>
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
      </section>
      <section className="usage-trend" aria-labelledby="usage-trend-title">
        <div className="usage-scope-heading">
          <h3 id="usage-trend-title">Usage over time</h3>
          <span className="task-muted">Select a bar to inspect calls</span>
        </div>
        <div className="usage-chart-scroll" ref={chart}>
          <div className="usage-chart" style={{ minWidth: Math.max(320, data.trend.length * 46) }}>
            {data.trend.map((point) => (
              <button
                key={point.date}
                type="button"
                className="usage-chart-point"
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
        <p className="task-muted">
          Workers use attempt start dates; routing and quota handoffs use their recorded dates, in
          your local time. Shaded caps show agent selection; ? marks missing reports. Cached input
          is counted once. This is not subscription quota or a monetary bill.
        </p>
      </section>
      <section className="usage-outcomes" aria-label="Usage by outcome">
        <h3>Usage by outcome</h3>
        <p>Tokens spent in this view, grouped by each task’s latest saved review.</p>
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
      <h3>{title}</h3>
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
        </Button>
      ))}
      {rows.length > 8 && (
        <p className="task-muted">Top 8 of {rows.length}; use the filters to inspect the rest.</p>
      )}
    </section>
  );
}
