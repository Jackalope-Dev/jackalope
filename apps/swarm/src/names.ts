/** Errors that explain a bad request; anything else is reported as an upstream failure. */
export class SwarmError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Artifacts repository name for one attempt's fork of `repo`. */
export function forkName(repo: string, attemptId: string) {
  const suffix = attemptId
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 12)
    .toLowerCase();
  if (suffix.length < 6)
    throw new SwarmError('Use an attempt ID with at least six letters or digits.');
  return `${repo.slice(0, 80)}--${suffix}`;
}

export const text = (value: unknown, limit: number, fallback = '') =>
  typeof value === 'string' ? value.trim().slice(0, limit) : fallback;
