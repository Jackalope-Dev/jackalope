export type Feature =
  | 'tasks'
  | 'chat'
  | 'project'
  | 'knowledge'
  | 'worktrees'
  | 'agents'
  | 'usage'
  | 'codebase'
  | 'settings'
  | 'connections'
  | 'schedules'
  | 'browser'
  | 'queue';
export type ErrorCode =
  | 'history_save_failed'
  | 'verification_failed'
  | 'update_failed'
  | 'ui_error'
  | 'ui_rejection'
  | 'ui_render_error'
  | 'history_load_failed'
  | 'agent_discovery_failed'
  | 'checkpoint_failed'
  | 'verification_error'
  | 'operation_failed'
  | 'task_failed';
export const operations = [
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
export type Operation = (typeof operations)[number];
export type OperationOutcome = 'accepted' | 'failed' | 'blocked' | 'partial' | 'canceled';
export const agents = [
  'codex',
  'claude',
  'grok',
  'opencode',
  'kimi',
  'antigravity',
  'gemini',
  'aider',
  'goose',
  'other',
] as const;
export type TelemetryAgent = (typeof agents)[number];
export type Workflow = 'task' | 'chat';
export type TaskState =
  | 'starting'
  | 'running'
  | 'review'
  | 'reviewed'
  | 'failed'
  | 'stopped'
  | 'interrupted';
export type Metric =
  | { name: 'app_opened' }
  | { name: 'feature_used'; feature: Feature }
  | { name: 'app_error'; code: ErrorCode; operation?: Operation; feature?: Feature }
  | { name: 'operation_result'; operation: Operation; outcome: OperationOutcome }
  | { name: 'task_state'; state: TaskState; agent?: TelemetryAgent; workflow?: Workflow };
type Event = Metric & { id: string };
export function createTelemetry(send: (events: Event[]) => Promise<unknown>, delay = 15_000) {
  let enabled = false,
    errors = false,
    generation = 0,
    sending = false;
  let queue: { event: Event; attempts: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!timer && enabled && queue.length)
      timer = setTimeout(
        () => {
          timer = undefined;
          void flush();
        },
        delay * 2 ** (queue[0]?.attempts ?? 0),
      );
  };
  const flush = async () => {
    if (!enabled || sending || !queue.length) return;
    clearTimeout(timer);
    timer = undefined;
    const batch = queue.splice(0, 50),
      epoch = generation;
    sending = true;
    try {
      await send(batch.map((entry) => entry.event));
    } catch {
      if (epoch === generation && enabled) {
        const retry = batch
          .filter((entry) => entry.attempts < 2)
          .map((entry) => ({ ...entry, attempts: entry.attempts + 1 }));
        queue = [...retry, ...queue].slice(0, 50);
      }
    } finally {
      sending = false;
      schedule();
    }
  };
  return {
    configure(usage: boolean, failures: boolean) {
      if (enabled === usage && errors === failures) return;
      generation++;
      enabled = usage;
      errors = failures;
      clearTimeout(timer);
      timer = undefined;
      queue = usage ? queue.filter((entry) => failures || entry.event.name !== 'app_error') : [];
      schedule();
    },
    track(metric: Metric) {
      if (!enabled || (metric.name === 'app_error' && !errors) || queue.length >= 50) return;
      queue.push({ event: { ...metric, id: crypto.randomUUID() }, attempts: 0 });
      schedule();
    },
    flush,
    stop() {
      enabled = false;
      generation++;
      queue = [];
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
