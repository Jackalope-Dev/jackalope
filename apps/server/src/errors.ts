/** An error with the HTTP status and stable error code a client receives. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/**
 * Messages the migrations raise with `RAISE(ABORT, ...)`, and what each means for
 * a client. D1 reports them inside a longer message, and the storage guards
 * carry a table prefix (`access_storage_capacity`), so they are matched as
 * substrings. Each surface names the ones its clients are told about; any other
 * trigger failure stays that surface's generic error.
 */
const TRIGGERS = {
  id_conflict: [409, 'id_conflict'],
  invite_capacity: [409, 'invitation_full'],
  invite_rate: [429, 'rate_limited'],
  device_capacity: [409, 'device_limit'],
  storage_capacity: [503, 'storage_capacity'],
} as const satisfies Record<string, readonly [status: number, code: string]>;
export type Trigger = keyof typeof TRIGGERS;

/** The client error for one of `triggers`' failures, or null for any other error. */
export function triggerError(error: unknown, triggers: readonly Trigger[]): ServiceError | null {
  const message = error instanceof Error ? error.message : String(error);
  const raised = triggers.find((trigger) => message.includes(trigger));
  return raised ? new ServiceError(...TRIGGERS[raised]) : null;
}
