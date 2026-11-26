import type { ErrorKind } from '@jackalope/contracts/telemetry';

/**
 * The broad class of an error, for error reports. The message is read here only to pick a
 * class; it never leaves this function, so paths, prompts and secrets in it are never sent.
 */
export function errorKind(reason: unknown): ErrorKind {
  const name = reason instanceof Error ? reason.name : '';
  const code =
    reason && typeof reason === 'object' && 'code' in reason
      ? String((reason as { code: unknown }).code)
      : '';
  const text = (
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : ''
  ).toLowerCase();
  if (name === 'AbortError' || /\babort|cancel(l)?ed\b/.test(text)) return 'aborted';
  if (name === 'TimeoutError' || code === 'ETIMEDOUT' || /timed? ?out/.test(text)) return 'timeout';
  if (/EACCES|EPERM/.test(code) || /permission|not allowed|denied|unauthori[sz]ed/.test(text))
    return 'permission';
  if (code === 'ENOENT' || /not found|no such file|does not exist/.test(text)) return 'not_found';
  if (
    /ECONN|ENOTFOUND|EAI_AGAIN/.test(code) ||
    /network|failed to fetch|load failed|offline|connection/.test(text)
  )
    return 'network';
  if (name === 'TypeError') return 'type';
  if (name === 'ReferenceError') return 'reference';
  if (name === 'RangeError') return 'range';
  if (name === 'SyntaxError') return 'syntax';
  return 'other';
}
