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
 * substrings in this order.
 */
const TRIGGERS: [message: string, status: number, code: string][] = [
  ['id_conflict', 409, 'id_conflict'],
  ['invite_capacity', 409, 'invitation_full'],
  ['invite_rate', 429, 'rate_limited'],
  ['device_capacity', 409, 'device_limit'],
  ['storage_capacity', 503, 'storage_capacity'],
];

/** The client error for a database trigger failure, or null for any other error. */
export function triggerError(error: unknown): ServiceError | null {
  const message = error instanceof Error ? error.message : String(error);
  const trigger = TRIGGERS.find(([raised]) => message.includes(raised));
  return trigger ? new ServiceError(trigger[1], trigger[2]) : null;
}
