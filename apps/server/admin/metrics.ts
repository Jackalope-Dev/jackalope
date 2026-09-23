export interface MetricCount {
  name: string;
  dimension: string;
  count: number;
}
export function operationCounts(metrics: MetricCount[]) {
  const rows = new Map<
    string,
    {
      operation: string;
      accepted: number;
      failed: number;
      blocked: number;
      partial: number;
      canceled: number;
    }
  >();
  for (const metric of metrics) {
    if (metric.name !== 'operation_result') continue;
    const [operation, outcome] = metric.dimension.split('|');
    if (!operation || !['accepted', 'failed', 'blocked', 'partial', 'canceled'].includes(outcome))
      continue;
    const row = rows.get(operation) ?? {
      operation,
      accepted: 0,
      failed: 0,
      blocked: 0,
      partial: 0,
      canceled: 0,
    };
    row[outcome as 'accepted' | 'failed' | 'blocked' | 'partial' | 'canceled'] += metric.count;
    rows.set(operation, row);
  }
  return [...rows.values()].sort((a, b) => b.failed - a.failed || b.accepted - a.accepted);
}

export function taskCounts(metrics: MetricCount[]) {
  const rows = new Map<string, { state: string; agent: string; workflow: string; count: number }>();
  for (const metric of metrics) {
    if (metric.name !== 'task_state') continue;
    const [state, agent = 'unknown', workflow = 'unknown'] = metric.dimension.split('|');
    const key = [state, agent, workflow].join('|');
    const row = rows.get(key) ?? { state, agent, workflow, count: 0 };
    row.count += metric.count;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count);
}
