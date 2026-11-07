/** A failure in words for the person who triggered it. Native commands reject with text or with objects carrying `message`. */
export function describeError(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'message' in cause)
    return String((cause as { message: unknown }).message);
  return String(cause);
}
