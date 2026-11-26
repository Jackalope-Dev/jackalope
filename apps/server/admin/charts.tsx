import { type PointerEvent, useId, useState } from 'react';
import type { Trend } from './insights';

/** Categorical colours in their fixed order; a series keeps its slot whatever else is shown. */
export const SERIES = Array.from({ length: 6 }, (_, index) => `var(--viz-${index + 1})`);

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

const compact = (value: number) =>
  value >= 10_000 ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k` : value.toLocaleString();

/** A rounded ceiling for the axis, so gridlines land on readable numbers. */
function niceMax(value: number) {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

export interface Line {
  key: string;
  values: number[];
  color: string;
}

function Legend({ items }: { items: { key: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="viz-legend">
      {items.map((item) => (
        <li key={item.key}>
          <span className="viz-swatch" style={{ background: item.color }} aria-hidden="true" />
          {item.key}
        </li>
      ))}
    </ul>
  );
}

function useHover(count: number) {
  const [index, setIndex] = useState<number | null>(null);
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / Math.max(1, box.width);
    setIndex(Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1)))));
  };
  return { index, move, leave: () => setIndex(null) };
}

const WIDTH = 640;

/** Change over time for one to a few series on one axis, with a crosshair readout. */
export function LineChart({
  dates,
  lines,
  label,
  height = 200,
}: {
  dates: string[];
  lines: Line[];
  label: string;
  height?: number;
}) {
  const gradient = useId();
  const hover = useHover(dates.length);
  const top = niceMax(Math.max(0, ...lines.flatMap((line) => line.values)));
  const x = (index: number) =>
    dates.length < 2 ? WIDTH / 2 : (index / (dates.length - 1)) * WIDTH;
  const y = (value: number) => height - 4 - (value / top) * (height - 12);
  const path = (values: number[]) =>
    values.map((value, index) => `${index ? 'L' : 'M'}${x(index)},${y(value)}`).join('');
  const single = lines.length === 1 ? lines[0] : undefined;
  const at = hover.index;
  return (
    <figure className="viz">
      <Legend items={lines} />
      <div className="viz-plot">
        <div className="viz-axis" aria-hidden="true">
          <span>{compact(top)}</span>
          <span>{compact(top / 2)}</span>
          <span>0</span>
        </div>
        <div className="viz-canvas">
          <svg
            viewBox={`0 0 ${WIDTH} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
            onPointerMove={hover.move}
            onPointerLeave={hover.leave}
          >
            {single && (
              <defs>
                <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={single.color} stopOpacity="0.22" />
                  <stop offset="1" stopColor={single.color} stopOpacity="0" />
                </linearGradient>
              </defs>
            )}
            {[0.5, 1].map((fraction) => (
              <line
                key={fraction}
                className="viz-grid"
                x1="0"
                x2={WIDTH}
                y1={y(top * fraction)}
                y2={y(top * fraction)}
              />
            ))}
            <line className="viz-baseline" x1="0" x2={WIDTH} y1={y(0)} y2={y(0)} />
            {single && (
              <path
                d={`${path(single.values)}L${x(dates.length - 1)},${y(0)}L${x(0)},${y(0)}Z`}
                fill={`url(#${gradient})`}
              />
            )}
            {lines.map((line) => (
              <path
                key={line.key}
                d={path(line.values)}
                className="viz-line"
                style={{ stroke: line.color }}
              />
            ))}
            {at !== null && (
              <line className="viz-crosshair" x1={x(at)} x2={x(at)} y1="0" y2={height} />
            )}
          </svg>
          {at !== null &&
            lines.map((line) => (
              <span
                key={line.key}
                className="viz-dot"
                style={{
                  left: `${(x(at) / WIDTH) * 100}%`,
                  top: `${(y(line.values[at]) / height) * 100}%`,
                  background: line.color,
                }}
              />
            ))}
          {at !== null && (
            <div
              className="viz-tooltip"
              role="status"
              data-side={at > dates.length / 2 ? 'left' : 'right'}
              style={{ left: `${(x(at) / WIDTH) * 100}%` }}
            >
              <strong>{shortDay(dates[at])}</strong>
              {lines.map((line) => (
                <span key={line.key}>
                  <span className="viz-swatch" style={{ background: line.color }} />
                  {lines.length > 1 ? `${line.key} ` : ''}
                  <b>{line.values[at].toLocaleString()}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="viz-ticks" aria-hidden="true">
        <span>{shortDay(dates[0])}</span>
        <span>{shortDay(dates[Math.floor((dates.length - 1) / 2)])}</span>
        <span>{shortDay(dates.at(-1) as string)}</span>
      </div>
    </figure>
  );
}

/** Daily totals split into a few layers, such as app versions. */
export function StackedBars({
  dates,
  layers,
  label,
  order,
  height = 180,
}: {
  dates: string[];
  layers: { key: string; daily: number[] }[];
  label: string;
  /** Every key that can appear, so each keeps its colour when filters hide others. */
  order: string[];
  height?: number;
}) {
  const hover = useHover(dates.length);
  const sums = dates.map((_, index) => layers.reduce((sum, layer) => sum + layer.daily[index], 0));
  const top = niceMax(Math.max(0, ...sums));
  const slot = WIDTH / dates.length;
  const bar = Math.max(2, slot - Math.min(10, slot * 0.3));
  const colored = layers.map((layer) => ({
    ...layer,
    color:
      layer.key === 'Other'
        ? 'var(--viz-other)'
        : SERIES[Math.max(0, order.indexOf(layer.key)) % SERIES.length],
  }));
  const at = hover.index;
  return (
    <figure className="viz">
      <Legend items={colored} />
      <div className="viz-plot">
        <div className="viz-axis" aria-hidden="true">
          <span>{compact(top)}</span>
          <span>{compact(top / 2)}</span>
          <span>0</span>
        </div>
        <div className="viz-canvas">
          <svg
            viewBox={`0 0 ${WIDTH} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
            onPointerMove={hover.move}
            onPointerLeave={hover.leave}
          >
            <line className="viz-grid" x1="0" x2={WIDTH} y1={height / 2} y2={height / 2} />
            {dates.map((day, index) => {
              let base = height;
              return (
                <g key={day} opacity={at === null || at === index ? 1 : 0.55}>
                  {colored.map((layer) => {
                    const size = (layer.daily[index] / top) * (height - 4);
                    if (size <= 0) return null;
                    base -= size;
                    return (
                      <rect
                        key={layer.key}
                        x={index * slot + (slot - bar) / 2}
                        y={base}
                        width={bar}
                        // A 2px surface gap between stacked segments.
                        height={Math.max(0, size - 2)}
                        rx={Math.min(3, bar / 3)}
                        fill={layer.color}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
          {at !== null && (
            <div
              className="viz-tooltip"
              role="status"
              data-side={at > dates.length / 2 ? 'left' : 'right'}
              style={{ left: `${((at + 0.5) / dates.length) * 100}%` }}
            >
              <strong>
                {shortDay(dates[at])} · {sums[at].toLocaleString()}
              </strong>
              {colored
                .filter((layer) => layer.daily[at])
                .map((layer) => (
                  <span key={layer.key}>
                    <span className="viz-swatch" style={{ background: layer.color }} />
                    {layer.key} <b>{layer.daily[at].toLocaleString()}</b>
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>
      <div className="viz-ticks" aria-hidden="true">
        <span>{shortDay(dates[0])}</span>
        <span>{shortDay(dates.at(-1) as string)}</span>
      </div>
    </figure>
  );
}

/** The later half of the window against the earlier half, in words and an arrow. */
export function Delta({ trend, invert = false }: { trend: Trend; invert?: boolean }) {
  if (trend.change === null)
    return <span className="viz-delta">{trend.current ? 'New' : '—'}</span>;
  const change = Math.round(trend.change * 100);
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const good = direction === 'flat' ? undefined : (direction === 'up') !== invert;
  return (
    <span
      className="viz-delta"
      data-good={good === undefined ? undefined : String(good)}
      title="Later half of the window compared with the earlier half"
    >
      {direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'} {Math.abs(change)}%
    </span>
  );
}

export function Sparkline({
  values,
  color = 'var(--viz-1)',
}: {
  values: number[];
  color?: string;
}) {
  const top = Math.max(1, ...values);
  const points = values
    .map(
      (value, index) =>
        `${(index / Math.max(1, values.length - 1)) * 60},${18 - (value / top) * 16}`,
    )
    .join(' ');
  return (
    <svg className="viz-spark" viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} style={{ stroke: color }} />
    </svg>
  );
}

/** Ranked totals with their share, recent direction and daily shape. */
export function BarList({
  items,
  invert = false,
  empty,
}: {
  items: { key: string; label: string; total: number; daily: number[]; trend: Trend }[];
  /** For counts where growth is bad, such as errors. */
  invert?: boolean;
  empty: string;
}) {
  if (!items.length) return <p className="notice">{empty}</p>;
  const top = Math.max(1, ...items.map((item) => item.total));
  return (
    <ol className="viz-bars">
      {items.map((item) => (
        <li key={item.key}>
          <span className="viz-bar-label" title={item.label}>
            {item.label}
          </span>
          <span className="viz-bar-track" aria-hidden="true">
            <span style={{ width: `${Math.max(2, (item.total / top) * 100)}%` }} />
          </span>
          <b>{item.total.toLocaleString()}</b>
          <Delta trend={item.trend} invert={invert} />
          <Sparkline values={item.daily} color={invert ? 'var(--color-danger)' : undefined} />
        </li>
      ))}
    </ol>
  );
}

/** Each step of a path as a share of the first, labelled as event counts. */
export function StepBars({ steps }: { steps: { key: string; value: number }[] }) {
  const first = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="viz-steps">
      {steps.map((step, index) => (
        <li key={step.key}>
          <span>{step.key}</span>
          <span className="viz-step-track" aria-hidden="true">
            <span style={{ width: `${Math.max(1, (step.value / first) * 100)}%` }} />
          </span>
          <b>{step.value.toLocaleString()}</b>
          <small>
            {index === 0
              ? '—'
              : `${steps[index - 1].value ? Math.round((step.value / steps[index - 1].value) * 100) : 0}% of previous`}
          </small>
        </li>
      ))}
    </ol>
  );
}
