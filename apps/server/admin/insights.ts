/**
 * Summaries of the daily usage counts for the admin dashboard. Every input is an anonymous
 * daily count, so everything here describes events, not people: there is no install or
 * account identity to count unique users, cohorts or per-person funnels from.
 */
export interface MetricRow {
  day: string;
  version: string;
  channel: string;
  os: string;
  name: string;
  dimension: string;
  count: number;
}

export interface Trend {
  /** The later half of the window. */
  current: number;
  /** The earlier half of the window. */
  previous: number;
  /** Relative change from the earlier half, or null without an earlier baseline. */
  change: number | null;
}

export interface Breakdown {
  key: string;
  total: number;
  daily: number[];
  trend: Trend;
}

/** The UTC dates of a window ending today, oldest first. */
export function dayRange(days: number, now = Date.now()) {
  return Array.from({ length: days }, (_, index) =>
    new Date(now - (days - index - 1) * 86400000).toISOString().slice(0, 10),
  );
}

/** Compares the later half of a daily series with the earlier half. */
export function trend(daily: number[]): Trend {
  const middle = Math.floor(daily.length / 2);
  const previous = daily.slice(0, middle).reduce((sum, value) => sum + value, 0);
  const current = daily.slice(daily.length - middle).reduce((sum, value) => sum + value, 0);
  return { current, previous, change: previous ? (current - previous) / previous : null };
}

/** Daily totals of the rows that match. */
export function series(rows: MetricRow[], dates: string[], match: (row: MetricRow) => boolean) {
  const index = new Map(dates.map((day, position) => [day, position]));
  const values = dates.map(() => 0);
  for (const row of rows) {
    const position = index.get(row.day);
    if (position !== undefined && match(row)) values[position] += row.count;
  }
  return values;
}

export const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

/** Groups one metric by a key read from its dimension, largest first. */
export function breakdown(
  rows: MetricRow[],
  dates: string[],
  name: string,
  key: (parts: string[], row: MetricRow) => string | null,
): Breakdown[] {
  const groups = new Map<string, MetricRow[]>();
  for (const row of rows) {
    if (row.name !== name) continue;
    const group = key(row.dimension.split('|'), row);
    if (group === null) continue;
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([group, members]) => {
      const daily = series(members, dates, () => true);
      return { key: group, total: total(daily), daily, trend: trend(daily) };
    })
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

/** App opens per day for the busiest versions, the rest folded into Other. */
export function versionAdoption(rows: MetricRow[], dates: string[], top = 5) {
  const opens = rows.filter((row) => row.name === 'app_opened');
  const versions = breakdown(opens, dates, 'app_opened', (_, row) => row.version);
  const keys = versions.slice(0, top).map((entry) => entry.key);
  const shown = new Set(keys);
  const rest = versions.filter((entry) => !shown.has(entry.key));
  const layers = versions.slice(0, top).map((entry) => ({ key: entry.key, daily: entry.daily }));
  if (rest.length)
    layers.push({
      key: 'Other',
      daily: dates.map((_, index) => total(rest.map((entry) => entry.daily[index]))),
    });
  return layers;
}

const FINISHED = new Set(['review', 'reviewed']);
const FAILED = new Set(['failed', 'interrupted']);

/** Run endings per agent: finished (ready to review), failed or stopped. */
export function outcomesByAgent(rows: MetricRow[]) {
  const agents = new Map<string, { finished: number; failed: number; stopped: number }>();
  for (const row of rows) {
    if (row.name !== 'task_state') continue;
    const [state, agent = 'unknown'] = row.dimension.split('|');
    const entry = agents.get(agent) ?? { finished: 0, failed: 0, stopped: 0 };
    if (FINISHED.has(state)) entry.finished += row.count;
    else if (FAILED.has(state)) entry.failed += row.count;
    else if (state === 'stopped') entry.stopped += row.count;
    else continue;
    agents.set(agent, entry);
  }
  return [...agents.entries()]
    .map(([agent, counts]) => {
      const ended = counts.finished + counts.failed + counts.stopped;
      return { agent, ...counts, ended, failureRate: ended ? counts.failed / ended : 0 };
    })
    .sort((a, b) => b.ended - a.ended);
}

/** The reading of an error dimension in each of its stored encodings. */
export function errorParts(dimension: string) {
  const [code, operation = '', feature = '', kind = ''] = dimension.split('|');
  return { code, operation, feature, kind };
}

/** Errors grouped by category, kind and where they happened, with the versions they hit. */
export function errorGroups(rows: MetricRow[], dates: string[]) {
  const groups = new Map<string, MetricRow[]>();
  for (const row of rows) {
    if (row.name !== 'app_error') continue;
    groups.set(row.dimension, [...(groups.get(row.dimension) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([dimension, members]) => {
      const daily = series(members, dates, () => true);
      const days = members.map((row) => row.day).sort();
      const versions = [...new Set(members.map((row) => row.version))].sort().reverse();
      return {
        ...errorParts(dimension),
        dimension,
        total: total(daily),
        daily,
        trend: trend(daily),
        first: days[0],
        last: days.at(-1) as string,
        versions,
      };
    })
    .sort((a, b) => b.total - a.total || a.dimension.localeCompare(b.dimension));
}

/** Event counts along the path from opening the app to finished work; ratios of events. */
export function activityPath(rows: MetricRow[]) {
  const sum = (match: (row: MetricRow) => boolean) =>
    rows.filter(match).reduce((count, row) => count + row.count, 0);
  const state = (row: MetricRow) => row.dimension.split('|')[0];
  return [
    { key: 'App opens', value: sum((row) => row.name === 'app_opened') },
    { key: 'Work sent', value: sum((row) => row.name === 'work_sent') },
    {
      key: 'Runs started',
      value: sum((row) => row.name === 'task_state' && state(row) === 'starting'),
    },
    {
      key: 'Runs finished',
      value: sum((row) => row.name === 'task_state' && FINISHED.has(state(row))),
    },
  ];
}

export interface Improvement {
  title: string;
  detail: string;
  tone: 'danger' | 'warning';
  /** How strongly it stands out, for ordering. */
  weight: number;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Where the counts point at something to fix: failing operations, agents and rising errors. */
export function improvements(rows: MetricRow[], dates: string[], minimum = 10): Improvement[] {
  const found: Improvement[] = [];
  const operations = new Map<string, { failed: number; total: number }>();
  for (const row of rows) {
    if (row.name !== 'operation_result') continue;
    const [operation, outcome] = row.dimension.split('|');
    const entry = operations.get(operation) ?? { failed: 0, total: 0 };
    entry.total += row.count;
    if (outcome === 'failed') entry.failed += row.count;
    operations.set(operation, entry);
  }
  for (const [operation, { failed, total: count }] of operations) {
    const rate = count ? failed / count : 0;
    if (count >= minimum && rate >= 0.1)
      found.push({
        title: `${label(operation)} fails ${percent(rate)} of the time`,
        detail: `${failed.toLocaleString()} of ${count.toLocaleString()} reported results failed.`,
        tone: rate >= 0.25 ? 'danger' : 'warning',
        weight: rate * Math.log10(count + 1),
      });
  }
  for (const agent of outcomesByAgent(rows))
    if (agent.ended >= minimum && agent.failureRate >= 0.2)
      found.push({
        title: `${label(agent.agent)} runs fail ${percent(agent.failureRate)} of the time`,
        detail: `${agent.failed.toLocaleString()} failed of ${agent.ended.toLocaleString()} runs that ended.`,
        tone: agent.failureRate >= 0.35 ? 'danger' : 'warning',
        weight: agent.failureRate * Math.log10(agent.ended + 1),
      });
  for (const group of errorGroups(rows, dates)) {
    const { change, current } = group.trend;
    if (current >= Math.ceil(minimum / 2) && change !== null && change >= 0.5)
      found.push({
        title: `${label(group.code)} reports are rising`,
        detail: `${current.toLocaleString()} in the later half of this window, up ${percent(change)}${group.operation ? ` in ${label(group.operation)}` : ''}${group.kind ? ` (${label(group.kind)})` : ''}.`,
        tone: change >= 1 ? 'danger' : 'warning',
        weight: Math.min(change, 3) * Math.log10(current + 1),
      });
  }
  const visits = new Map<string, number>();
  for (const row of rows)
    if (row.name === 'feature_used')
      visits.set(row.dimension, (visits.get(row.dimension) ?? 0) + row.count);
  const pageErrors = new Map<string, number>();
  for (const row of rows) {
    if (row.name !== 'app_error') continue;
    const { feature } = errorParts(row.dimension);
    if (feature) pageErrors.set(feature, (pageErrors.get(feature) ?? 0) + row.count);
  }
  for (const [feature, errors] of pageErrors) {
    const seen = visits.get(feature) ?? 0;
    const rate = seen ? errors / seen : 1;
    if (errors >= Math.ceil(minimum / 2) && rate >= 0.05)
      found.push({
        title: `${label(feature)} shows errors on ${percent(Math.min(rate, 1))} of visits`,
        detail: `${errors.toLocaleString()} errors against ${seen.toLocaleString()} visits.`,
        tone: rate >= 0.2 ? 'danger' : 'warning',
        weight: Math.min(rate, 1) * Math.log10(errors + 1),
      });
  }
  return found.sort((a, b) => b.weight - a.weight);
}

/** A readable form of an enumerated value such as `live_session_send`. */
export function label(value: string) {
  if (!value) return 'Unknown';
  const words = value.replace(/_/g, ' ').replace(/\bui\b/gi, 'UI');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
