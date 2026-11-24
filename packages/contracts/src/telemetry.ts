/**
 * The usage and error report contract. The service validates against these
 * lists, the desktop reports with them, and the native client is checked
 * against apps/desktop/scripts/fixtures/telemetry-events.json.
 */
export const FEATURES = [
  'tasks',
  'chat',
  'project',
  'knowledge',
  'worktrees',
  'agents',
  'usage',
  'codebase',
  'settings',
  'connections',
  'schedules',
  'browser',
  'queue',
] as const;
export type Feature = (typeof FEATURES)[number];

export const OPERATIONS = [
  'task_start',
  'task_retry',
  'task_stop',
  'task_verify',
  'task_respond_prompt',
  'task_outcome_review',
  'task_preview_start',
  'task_preview_inspect',
  'task_retry_save',
  'task_export_recovery',
  'task_import_recovery',
  'live_session_create',
  'live_session_send',
  'live_session_review',
  'live_session_pause',
  'live_session_resume',
  'live_session_retry',
  'live_session_finish',
  'live_session_limits',
  'live_session_window',
  'queue_add',
  'queue_import',
  'queue_dispatch',
  'integration_prepare',
  'integration_apply',
  'schedule_save',
  'schedule_set_enabled',
  'knowledge_save',
  'knowledge_search',
  'mcp_save_server',
  'mcp_probe_server',
  'mcp_authenticate',
  'git_create_worktree',
  'git_cleanup_worktree',
  'git_archive_worktree',
  'agent_profile_create',
  'agent_profile_sign_in',
  'local_ai_connect',
  'helper_send',
  'helper_action',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const OPERATION_OUTCOMES = ['accepted', 'failed', 'blocked', 'partial', 'canceled'] as const;
export type OperationOutcome = (typeof OPERATION_OUTCOMES)[number];

export const TELEMETRY_AGENTS = [
  'codex',
  'claude',
  'grok',
  'opencode',
  'kimi',
  'antigravity',
  'gemini',
  'other',
] as const;
export type TelemetryAgent = (typeof TELEMETRY_AGENTS)[number];

export const WORKFLOWS = ['task', 'chat'] as const;
export type Workflow = (typeof WORKFLOWS)[number];

export const TASK_STATES = [
  'starting',
  'running',
  'review',
  'reviewed',
  'failed',
  'stopped',
  'interrupted',
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const ERROR_CODES = [
  'history_save_failed',
  'verification_failed',
  'update_failed',
  'ui_error',
  'ui_rejection',
  'ui_render_error',
  'history_load_failed',
  'agent_discovery_failed',
  'checkpoint_failed',
  'verification_error',
  'operation_failed',
  'task_failed',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type Metric =
  | { name: 'app_opened' }
  | { name: 'feature_used'; feature: Feature }
  | { name: 'app_error'; code: ErrorCode; operation?: Operation; feature?: Feature }
  | { name: 'operation_result'; operation: Operation; outcome: OperationOutcome }
  | { name: 'task_state'; state: TaskState; agent?: TelemetryAgent; workflow?: Workflow };

export type MetricName = Metric['name'];

/**
 * The `metrics.dimension` column: the fields a daily count is grouped by,
 * joined with `|`. Stored rows use this encoding, so it cannot change.
 */
export function metricDimension(metric: Metric): string {
  switch (metric.name) {
    case 'operation_result':
      return [metric.operation, metric.outcome].join('|');
    case 'task_state':
      return metric.agent || metric.workflow
        ? [metric.state, metric.agent ?? 'unknown', metric.workflow ?? 'unknown'].join('|')
        : metric.state;
    case 'feature_used':
      return metric.feature;
    case 'app_error':
      return metric.operation || metric.feature
        ? [metric.code, metric.operation ?? '', metric.feature ?? ''].join('|')
        : metric.code;
    case 'app_opened':
      return '';
  }
}

/** A stored daily count, as the admin overview returns it. */
export interface MetricCount {
  name: string;
  dimension: string;
  count: number;
}

/** `operation_result` counts per operation, most failures first. */
export function operationCounts(metrics: MetricCount[]) {
  const rows = new Map<string, { operation: string } & Record<OperationOutcome, number>>();
  for (const metric of metrics) {
    if (metric.name !== 'operation_result') continue;
    const [operation, outcome] = metric.dimension.split('|');
    if (!operation || !OPERATION_OUTCOMES.includes(outcome as OperationOutcome)) continue;
    const row = rows.get(operation) ?? {
      operation,
      ...(Object.fromEntries(OPERATION_OUTCOMES.map((key) => [key, 0])) as Record<
        OperationOutcome,
        number
      >),
    };
    row[outcome as OperationOutcome] += metric.count;
    rows.set(operation, row);
  }
  return [...rows.values()].sort((a, b) => b.failed - a.failed || b.accepted - a.accepted);
}

/** `task_state` counts per state, agent and workflow, largest first. */
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

/** The non-empty parts of a dimension, for display. */
export function dimensionParts(dimension: string) {
  return dimension.split('|').filter(Boolean);
}
