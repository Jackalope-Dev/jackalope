import { z } from 'zod';

const uuid = z.uuid({ version: 'v4' });
const version = z
  .string()
  .max(32)
  .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
const os = z.enum(['windows', 'macos', 'linux']);
const common = { id: uuid, appVersion: version, os, channel: z.enum(['stable', 'beta']) };
const event = z.discriminatedUnion('name', [
  z.strictObject({ ...common, name: z.literal('app_opened') }),
  z.strictObject({
    ...common,
    name: z.literal('task_state'),
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
    feature: z.enum([
      'tasks',
      'worktrees',
      'agents',
      'usage',
      'codebase',
      'settings',
      'connections',
      'schedules',
      'browser',
      'queue',
    ]),
  }),
  z.strictObject({
    ...common,
    name: z.literal('app_error'),
    code: z.enum([
      'history_save_failed',
      'verification_failed',
      'update_failed',
      'ui_error',
      'task_failed',
    ]),
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
