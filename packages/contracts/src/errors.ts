/** A failure in words for the person who triggered it. Native commands reject with text or with objects carrying `message`. */
export function describeError(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'message' in cause)
    return String((cause as { message: unknown }).message);
  return String(cause);
}

/** The `code` a native command attached to its failure, when it attached one. */
export function errorCode(cause: unknown): string | undefined {
  if (cause && typeof cause === 'object' && 'code' in cause) {
    const code = (cause as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
