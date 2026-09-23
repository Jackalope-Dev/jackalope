import { z } from 'zod';

const uuid = z.uuid({ version: 'v4' });
const version = z
  .string()
  .max(32)
  .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
const os = z.enum(['windows', 'macos', 'linux']);
const common = { id: uuid, appVersion: version, os, channel: z.enum(['stable', 'beta']) };
const feature = z.enum([
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
]);
const operation = z.enum([
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
]);
const event = z.discriminatedUnion('name', [
  z.strictObject({ ...common, name: z.literal('app_opened') }),
  z.strictObject({
    ...common,
    name: z.literal('task_state'),
    agent: z
      .enum(['codex', 'claude', 'grok', 'opencode', 'kimi', 'antigravity', 'gemini', 'other'])
      .optional(),
    workflow: z.enum(['task', 'chat']).optional(),
    state: z.enum([
      'starting',
      'running',
      'review',
      'reviewed',
      'failed',
      'stopped',
      'interrupted',
    ]),
  }),
  z.strictObject({
    ...common,
    name: z.literal('feature_used'),
    feature,
  }),
  z.strictObject({
    ...common,
    name: z.literal('app_error'),
    feature: feature.optional(),
    operation: operation.optional(),
    code: z.enum([
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
    ]),
  }),
  z.strictObject({
    ...common,
    name: z.literal('operation_result'),
    operation,
    outcome: z.enum(['accepted', 'failed', 'blocked', 'partial', 'canceled']),
  }),
]);
export const telemetrySchema = z.strictObject({
  schemaVersion: z.literal(2),
  events: z.array(event).min(1).max(50),
});
const count = z.number().int().min(0).max(10_000_000);
export const feedbackSchema = z.strictObject({
  schemaVersion: z.literal(2),
  ...common,
  kind: z.enum(['bug', 'feature', 'idea']),
  message: z.string().min(1).max(8000).regex(/\S/),
  diagnostics: z
    .strictObject({ attempts: count, reviewed: count, failed: count, historySaveFailures: count })
    .optional(),
});
export type Telemetry = z.infer<typeof telemetrySchema>;
export type Feedback =
  | z.infer<typeof feedbackSchema>
  | {
      schemaVersion: 2;
      id: string;
      kind: 'idea';
      message: string;
      source: 'email';
      appVersion?: never;
      os?: never;
      channel?: never;
      diagnostics?: never;
    };
