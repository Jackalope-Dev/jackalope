import { latestTaskRuns, recordedOutcome } from './agent-analytics.ts';
import type { RunUsage, TaskRun } from './task-runtime.ts';
import type { usageEntries } from './usage-entries.ts';

export type UsageEntry = ReturnType<typeof usageEntries>[number];
export const usageAccountKey = (r: UsageEntry) =>
  `${r.accountBinding?.adapter ?? r.agent}:${r.accountBinding?.profileId ?? 'cli-default'}`;
export const usageTaskKey = (r: TaskRun) => JSON.stringify([r.projectId, r.projectPath, r.taskId]);
export const usageDateKey = (date: string, monthly = false) => {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return 'Undated';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}${monthly ? '' : `-${String(d.getDate()).padStart(2, '0')}`}`;
};
export function usageCutoff(period: string, now = new Date()) {
  if (period === 'all') return 0;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Number(period) + 1);
  return start.getTime();
}
export function summarizeUsage(items: { usage: RunUsage }[]) {
  const reported = items.filter((r) => r.usage.reported);
  const input = reported.reduce((sum, r) => sum + r.usage.input, 0);
  const output = reported.reduce((sum, r) => sum + r.usage.output, 0);
  const cacheRead = reported.reduce((sum, r) => sum + r.usage.cacheRead, 0);
  const cacheWrite = reported.reduce((sum, r) => sum + r.usage.cacheWrite, 0);
  const priced = reported.filter((r) => typeof r.usage.estimatedCostUsd === 'number');
  return {
    calls: items.length,
    reported: reported.length,
    missing: items.length - reported.length,
    input,
    output,
    tokens: reported.length ? input + output : items.length ? null : 0,
    cacheRead,
    cacheWrite,
    // Cached and cache-write tokens are already inside `input`. They are the same context
    // re-sent on later model calls, so only the remainder is context the provider read as new.
    freshInput: reported.length
      ? Math.max(0, input - cacheRead - cacheWrite)
      : items.length
        ? null
        : 0,
    costUsd: priced.length
      ? priced.reduce((sum, r) => sum + (r.usage.estimatedCostUsd ?? 0), 0)
      : null,
    costMissing: reported.length - priced.length,
  };
}

/**
 * Cumulative prompt tokens re-count the whole conversation on every model call, so they
 * scale with turn count rather than work done. Lead with the figures that do not.
 */
export function describeRunUsage(run: TaskRun) {
  const { usage } = run;
  const cacheless = run.accountBinding?.adapter === 'kimi' || run.agent === 'kimi';
  const calls = run.usageObservations?.length ?? 0;
  const parts: string[] = [];
  if (typeof usage.estimatedCostUsd === 'number') {
    parts.push(`$${usage.estimatedCostUsd.toFixed(2)} reported cost`);
  }
  parts.push(
    cacheless
      ? `${usage.input.toLocaleString()} input · cache breakdown unavailable`
      : `${Math.max(0, usage.input - usage.cacheRead - usage.cacheWrite).toLocaleString()} new context · ${usage.cacheRead.toLocaleString()} cached re-reads`,
  );
  parts.push(`${usage.output.toLocaleString()} output`);
  if (calls) {
    parts.push(
      `${calls.toLocaleString()} model calls · ${Math.round(usage.input / calls).toLocaleString()} avg context`,
    );
  }
  parts.push(`${(usage.input + usage.output).toLocaleString()} cumulative tokens`);
  return parts.join(' · ');
}
export function usageInsights(
  entries: UsageEntry[],
  runs: TaskRun[],
  period: string,
  now = new Date(),
) {
  const latest = new Map(latestTaskRuns(runs).map((r) => [usageTaskKey(r), r]));
  const grouped = new Map<string, UsageEntry[]>();
  for (const row of entries) {
    const key = usageTaskKey(row);
    const rows = grouped.get(key);
    if (rows) rows.push(row);
    else grouped.set(key, [row]);
  }
  const tasks = [...grouped]
    .map(([key, rows]) => {
      const run = latest.get(key) ?? rows[0];
      return {
        key,
        run,
        rows,
        ...summarizeUsage(rows),
        attempts: new Set(rows.map((r) => r.id)).size,
        outcome: recordedOutcome(run),
        routing: summarizeUsage(rows.filter((r) => r.purpose === 'Routing')),
        agents: [...new Set(rows.map((r) => r.agent))],
      };
    })
    .sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || a.key.localeCompare(b.key));
  const groupBy = (key: (r: UsageEntry) => string) => {
    const groups = new Map<string, UsageEntry[]>();
    for (const row of entries) {
      const id = key(row);
      const rows = groups.get(id);
      if (rows) rows.push(row);
      else groups.set(id, [row]);
    }
    return [...groups]
      .map(([id, rows]) => {
        const keys = new Set(rows.map(usageTaskKey));
        return {
          id,
          label: rows[0].projectId === id ? rows[0].projectName : id,
          ...summarizeUsage(rows),
          tasks: keys.size,
          accepted: tasks.filter((task) => keys.has(task.key) && task.outcome === 'accepted')
            .length,
        };
      })
      .sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || a.id.localeCompare(b.id));
  };
  const dates = new Map<string, UsageEntry[]>();
  if (period !== 'all') {
    const date = new Date(usageCutoff(period, now));
    for (let i = 0; i < Number(period); i++) {
      dates.set(usageDateKey(date.toISOString()), []);
      date.setDate(date.getDate() + 1);
    }
  }
  for (const row of entries) {
    const key = usageDateKey(row.startedAt, period === 'all');
    const rows = dates.get(key);
    if (rows) rows.push(row);
    else dates.set(key, [row]);
  }
  const total = summarizeUsage(entries);
  const routing = summarizeUsage(entries.filter((r) => r.purpose === 'Routing'));
  return {
    total,
    routing,
    worker: summarizeUsage(entries.filter((r) => r.purpose === 'Worker')),
    handoffs: summarizeUsage(entries.filter((r) => r.purpose === 'Worker · quota handoff')),
    outcomes: [
      { id: 'accepted', label: 'Accepted by you' },
      { id: 'changes', label: 'Needs changes' },
      { id: null, label: 'Not measured' },
    ].map(({ id, label }) => {
      const matching = tasks.filter((task) => task.outcome === id);
      return {
        label,
        tasks: matching.length,
        ...summarizeUsage(matching.flatMap((task) => task.rows)),
      };
    }),
    routingPercent:
      total.tokens && !total.missing ? (100 * (routing.tokens ?? 0)) / total.tokens : null,
    tasks,
    accepted: tasks.filter((t) => t.outcome === 'accepted').length,
    changes: tasks.filter((t) => t.outcome === 'changes').length,
    projects: groupBy((r) => r.projectId),
    agents: groupBy((r) => r.agent),
    trend: [...dates]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows]) => ({
        date,
        ...summarizeUsage(rows),
        routing: summarizeUsage(rows.filter((r) => r.purpose === 'Routing')).tokens,
      })),
  };
}
export type UsageInsights = ReturnType<typeof usageInsights>;
