import { PLATFORMS, RELEASE_CHANNELS, SEMVER } from '@jackalope/contracts/platform';
import {
  ERROR_CODES,
  FEATURES,
  OPERATION_OUTCOMES,
  OPERATIONS,
  TASK_STATES,
  TELEMETRY_AGENTS,
  WORKFLOWS,
} from '@jackalope/contracts/telemetry';
import { z } from 'zod';

const uuid = z.uuid({ version: 'v4' });
const version = z.string().max(32).regex(SEMVER);
const os = z.enum(PLATFORMS);
const common = { id: uuid, appVersion: version, os, channel: z.enum(RELEASE_CHANNELS) };
const feature = z.enum(FEATURES);
const operation = z.enum(OPERATIONS);
const event = z.discriminatedUnion('name', [
  z.strictObject({ ...common, name: z.literal('app_opened') }),
  z.strictObject({
    ...common,
    name: z.literal('task_state'),
    agent: z.enum(TELEMETRY_AGENTS).optional(),
    workflow: z.enum(WORKFLOWS).optional(),
    state: z.enum(TASK_STATES),
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
    code: z.enum(ERROR_CODES),
  }),
  z.strictObject({
    ...common,
    name: z.literal('operation_result'),
    operation,
    outcome: z.enum(OPERATION_OUTCOMES),
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
