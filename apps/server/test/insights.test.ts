import { describe, expect, it } from 'vitest';
import {
  activityPath,
  breakdown,
  dayRange,
  errorGroups,
  errorParts,
  improvements,
  type MetricRow,
  outcomesByAgent,
  series,
  trend,
  versionAdoption,
} from '../admin/insights';

const now = Date.parse('2026-11-25T12:00:00Z');
const dates = dayRange(4, now);
const row = (day: number, name: string, dimension: string, count: number, version = '0.2.0') =>
  ({
    day: dates[day],
    version,
    channel: 'stable',
    os: 'macos',
    name,
    dimension,
    count,
  }) as MetricRow;

describe('usage insights', () => {
  it('builds the window oldest first and compares its halves', () => {
    expect(dates).toEqual(['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
    expect(trend([1, 1, 3, 3])).toEqual({ current: 6, previous: 2, change: 2 });
    expect(trend([0, 0, 2, 2]).change).toBeNull();
  });

  it('totals days and groups dimensions, ignoring rows outside the window', () => {
    const rows = [
      row(0, 'feature_used', 'tasks', 2),
      row(3, 'feature_used', 'tasks', 5),
      row(3, 'feature_used', 'settings', 1),
      { ...row(0, 'feature_used', 'tasks', 99), day: '2026-10-01' },
    ];
    expect(series(rows, dates, (entry) => entry.name === 'feature_used')).toEqual([2, 0, 0, 6]);
    const grouped = breakdown(rows, dates, 'feature_used', ([feature]) => feature);
    expect(grouped.map((entry) => [entry.key, entry.total])).toEqual([
      ['tasks', 7],
      ['settings', 1],
    ]);
  });

  it('folds smaller versions into Other', () => {
    const rows = ['0.1.0', '0.2.0', '0.3.0'].map((version, index) =>
      row(index, 'app_opened', '', 10 - index, version),
    );
    const layers = versionAdoption(rows, dates, 2);
    expect(layers.map((layer) => layer.key)).toEqual(['0.1.0', '0.2.0', 'Other']);
    expect(layers[2].daily).toEqual([0, 0, 8, 0]);
  });

  it('reads every stored error encoding and keeps first and last seen', () => {
    expect(errorParts('ui_error')).toEqual({
      code: 'ui_error',
      operation: '',
      feature: '',
      kind: '',
    });
    expect(errorParts('operation_failed|task_start|')).toMatchObject({ operation: 'task_start' });
    expect(errorParts('ui_error|||network').kind).toBe('network');
    const groups = errorGroups(
      [
        row(1, 'app_error', 'ui_error|||network', 2, '0.1.0'),
        row(3, 'app_error', 'ui_error|||network', 3, '0.2.0'),
      ],
      dates,
    );
    expect(groups[0]).toMatchObject({
      total: 5,
      first: dates[1],
      last: dates[3],
      versions: ['0.2.0', '0.1.0'],
    });
  });

  it('counts run endings per agent and the path to finished work', () => {
    const rows = [
      row(0, 'app_opened', '', 20),
      row(0, 'work_sent', 'conversation|claude|0|no_window', 8),
      row(0, 'task_state', 'starting|claude|chat', 8),
      row(1, 'task_state', 'review|claude|chat', 5),
      row(1, 'task_state', 'failed|claude|chat', 2),
      row(1, 'task_state', 'stopped|claude|chat', 1),
    ];
    expect(outcomesByAgent(rows)[0]).toMatchObject({
      agent: 'claude',
      finished: 5,
      failed: 2,
      stopped: 1,
      failureRate: 0.25,
    });
    expect(activityPath(rows).map((step) => step.value)).toEqual([20, 8, 8, 5]);
  });

  it('flags failing operations, agents and rising errors, and stays quiet when healthy', () => {
    const healthy = [row(0, 'operation_result', 'task_start|accepted', 100)];
    expect(improvements(healthy, dates)).toEqual([]);
    const rows = [
      row(0, 'operation_result', 'live_session_send|accepted', 30),
      row(0, 'operation_result', 'live_session_send|failed', 20),
      row(0, 'task_state', 'review|codex|chat', 6),
      row(0, 'task_state', 'failed|codex|chat', 6),
      row(0, 'app_error', 'ui_error|||network', 1),
      row(3, 'app_error', 'ui_error|||network', 9),
    ];
    const titles = improvements(rows, dates).map((item) => item.title);
    expect(titles).toContain('Live session send fails 40% of the time');
    expect(titles).toContain('Codex runs fail 50% of the time');
    expect(titles).toContain('UI error reports are rising');
  });
});
