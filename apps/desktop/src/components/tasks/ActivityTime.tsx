import { durationLabel } from '@jackalope/contracts/runs';
import { Table, Tooltip } from '@jackalope/ui';
import type { TimeBreakdown } from '../../lib/task-report';
import './activity-time.css';

export const timeLabel = (ms: number) => (ms < 1000 && ms > 0 ? '<1s' : durationLabel(ms / 1000));
export const percentLabel = (share: number) =>
  share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;

/** The agent's working time as one stacked bar with a labelled legend. */
export function ActivityTimeBar({ breakdown, label }: { breakdown: TimeBreakdown; label: string }) {
  const shown = breakdown.groups.filter((group) => group.ms > 0);
  const summary = shown.map((group) => `${group.label} ${percentLabel(group.share)}`).join(', ');
  return (
    <div className="activity-time">
      <div className="activity-time-bar" role="img" aria-label={`${label}: ${summary}`}>
        {shown.map((group) => (
          <Tooltip
            key={group.id}
            content={
              <span className="activity-time-tip">
                <strong>{group.label}</strong>
                {timeLabel(group.ms)} · {percentLabel(group.share)}
              </span>
            }
          >
            <span
              className="activity-time-segment"
              data-activity={group.id}
              style={{ flexGrow: group.ms }}
            />
          </Tooltip>
        ))}
      </div>
      <ul className="activity-time-legend">
        {shown.map((group) => (
          <li key={group.id}>
            <span className="activity-time-swatch" data-activity={group.id} aria-hidden="true" />
            <span className="activity-time-legend-label">{group.label}</span>
            <span className="activity-time-legend-value">
              {timeLabel(group.ms)} <small>{percentLabel(group.share)}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every kind of activity behind the bar, longest first. */
export function ActivityTimeTable({
  breakdown,
  label,
}: {
  breakdown: TimeBreakdown;
  label: string;
}) {
  return (
    <Table className="activity-time-table" label={label}>
      <thead>
        <tr>
          <th>Activity</th>
          <th>Time</th>
          <th>Share</th>
          <th>Calls</th>
          <th>Longest call</th>
        </tr>
      </thead>
      <tbody>
        {breakdown.lines.map((line) => (
          <tr key={line.kind}>
            <td>
              <span className="activity-time-tool">
                <span
                  className="activity-time-swatch"
                  data-activity={line.group}
                  aria-hidden="true"
                />
                {line.label}
              </span>
            </td>
            <td>{timeLabel(line.wallMs)}</td>
            <td>
              <span className="activity-time-share">
                <span
                  className="activity-time-share-fill"
                  data-activity={line.group}
                  style={{ width: `${Math.max(line.share * 100, line.wallMs ? 1 : 0)}%` }}
                />
              </span>
              {percentLabel(line.share)}
            </td>
            <td>{line.kind === 'think' ? '—' : line.calls.toLocaleString()}</td>
            <td>{line.longestMs ? timeLabel(line.longestMs) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
