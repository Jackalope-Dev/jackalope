/** Errors that explain a bad request; anything else is reported as an upstream failure. */
export class SwarmError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * What a Swarm Durable Object method returns. RPC keeps only an error's message,
 * so methods report the status themselves instead of throwing.
 */
export type SwarmResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export async function settle<T>(work: () => Promise<T>): Promise<SwarmResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (cause) {
    if (cause instanceof SwarmError)
      return { ok: false, status: cause.status, error: cause.message };
    const error = cause instanceof Error ? cause.message : String(cause);
    // Artifacts reports a missing repository only in its message.
    return { ok: false, status: /not found/i.test(error) ? 404 : 502, error };
  }
}

/** An Artifacts repository name, for the shared repository and its forks. */
export const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Every fork of `repo` is named with this prefix. */
export const forkPrefix = (repo: string) => `${repo.slice(0, 80)}--`;

/** Artifacts repository name for one attempt's fork of `repo`. */
export function forkName(repo: string, attemptId: string) {
  const suffix = attemptId
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 12)
    .toLowerCase();
  if (suffix.length < 6)
    throw new SwarmError('Use an attempt ID with at least six letters or digits.');
  return `${forkPrefix(repo)}${suffix}`;
}

export const text = (value: unknown, limit: number, fallback = '') =>
  typeof value === 'string' ? value.trim().slice(0, limit) : fallback;
