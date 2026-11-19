import { AlertTriangle, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { capacityWindowDisplay } from '../../lib/capacity-display';
import type { CapacityRecord } from '../../stores/capacityStore';
import { ProviderMark } from '../agents/ProviderMark';

type WindowDisplay = ReturnType<typeof capacityWindowDisplay>;

interface UsageWindow {
  key: string;
  remaining: number | null;
  label: WindowDisplay['label'];
  tone: WindowDisplay['tone'];
  /** Short window name, with the pool's name when it is not the plan itself: "7-day", "Opus · Weekly". */
  name: string;
  /** The window's full name for sentences: "7-day window", "Weekly allowance". */
  longName: string;
  resetsAt: number | null;
}

export interface UsageSummary {
  record: CapacityRecord;
  agentName: string;
  /** The most limiting window first; the status bar pill shows it. */
  windows: UsageWindow[];
}

export const formatPercent = (remaining: number) =>
  `${remaining.toLocaleString(undefined, { maximumFractionDigits: remaining < 10 ? 1 : 0 })}%`;

/** Time until a window resets, in its largest whole unit: "in 3h", "in 2d". */
export function resetsIn(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/** How long ago the oldest shown reading was taken: "just now", "4m ago". */
export function updatedAgo(observedAt: number, now: number) {
  const minutes = Math.floor((now - observedAt) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

const resetText = (window: UsageWindow, now: number) =>
  window.resetsAt != null && window.resetsAt * 1000 > now
    ? `resets ${resetsIn(window.resetsAt * 1000 - now)}`
    : null;

/**
 * A remaining-allowance ring. The arc runs clockwise from twelve o'clock over a track tinted
 * from the same status color; an unknown value draws only a dashed track, never a guess.
 */
function AllowanceRing({
  window,
  size,
  stroke,
  children,
}: {
  window: UsageWindow | undefined;
  size: number;
  stroke: number;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const center = size / 2;
  const remaining = window?.remaining ?? null;
  return (
    <span
      className="usage-ring"
      data-tone={window?.tone ?? 'unknown'}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="usage-ring-track"
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={stroke}
          pathLength={100}
        />
        {remaining !== null && remaining > 0 && (
          <circle
            className="usage-ring-value"
            cx={center}
            cy={center}
            r={radius}
            strokeWidth={stroke}
            pathLength={100}
            strokeDasharray={`${remaining} 100`}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
      </svg>
      {children}
    </span>
  );
}

/** The non-color cue that goes with a low or used-up allowance. */
function ToneCue({ tone, withLabel }: { tone: UsageWindow['tone']; withLabel: boolean }) {
  if (tone !== 'low' && tone !== 'empty') return null;
  const Icon = tone === 'low' ? AlertTriangle : CircleAlert;
  return (
    <span className="usage-tone-cue" data-tone={tone}>
      <Icon size={12} aria-hidden="true" />
      {withLabel && (tone === 'low' ? 'Low' : 'Used up')}
    </span>
  );
}

function UsageTile({ summary, now }: { summary: UsageSummary; now: number }) {
  const [primary, ...others] = summary.windows;
  const reset = primary && resetText(primary, now);
  const detail =
    primary?.remaining == null
      ? [primary?.label ?? 'Not reported', primary?.name].filter(Boolean).join(' · ')
      : [primary.name, reset].filter(Boolean).join(' · ');
  return (
    <div className="usage-tile" data-tone={primary?.tone ?? 'unknown'}>
      <AllowanceRing window={primary} size={48} stroke={4}>
        <span className="usage-ring-icon">
          <ProviderMark provider={summary.record.agent} size={20} />
        </span>
      </AllowanceRing>
      <div className="usage-tile-text">
        <span className="usage-tile-agent">{summary.agentName}</span>
        <span className="usage-tile-figure">
          <strong className="usage-tile-value">
            {primary?.remaining == null ? '—' : formatPercent(primary.remaining)}
          </strong>
          {primary?.remaining != null && <span>left</span>}
          {primary && <ToneCue tone={primary.tone} withLabel />}
        </span>
        <span className="usage-tile-detail">{detail}</span>
        {others.map((window) => {
          const otherReset = resetText(window, now);
          return (
            <span className="usage-tile-window" key={window.key} data-tone={window.tone}>
              <AllowanceRing window={window} size={14} stroke={2.5} />
              <span className="usage-tile-window-name">{window.name}</span>
              <span className="usage-tile-window-value">
                {window.remaining != null
                  ? formatPercent(window.remaining)
                  : window.label === primary?.label
                    ? '—'
                    : window.label}
              </span>
              <ToneCue tone={window.tone} withLabel={false} />
              {window.remaining != null && otherReset && (
                <span className="usage-tile-window-reset">{otherReset}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The status bar's hover card: one ring per account for its most limiting window, smaller
 * rings for its other windows, and when the readings were taken. Screen readers get the same
 * facts as sentences from the trigger's label, so everything here is presentational.
 */
export function StatusBarUsageCard({
  summaries,
  now,
  freshness,
  loading,
  error,
}: {
  summaries: UsageSummary[];
  now: number;
  freshness: string | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="usage-card">
      {summaries.map((summary) => (
        <UsageTile key={summary.record.agent} summary={summary} now={now} />
      ))}
      <p className="usage-card-footer">
        {error ? (
          <span className="usage-card-error">
            <CircleAlert size={12} aria-hidden="true" />
            {error}
          </span>
        ) : loading ? (
          'Checking allowances…'
        ) : (
          (freshness ?? 'Not checked yet')
        )}
      </p>
    </div>
  );
}
