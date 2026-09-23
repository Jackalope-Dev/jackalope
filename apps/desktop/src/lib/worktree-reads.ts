import { listWorktrees, type WorktreeEntry } from './tauri-bridge.ts';

export function createWorktreeReader(
  read = listWorktrees,
  listTimeout = 15_000,
  inspectionTimeout = 60_000,
) {
  const pending = new Map<string, Promise<WorktreeEntry[]>>();
  return (path: string, target: string | undefined, inspect: boolean) => {
    const key = JSON.stringify([path, target, inspect]);
    const existing = pending.get(key);
    if (existing) return existing;
    let timer: ReturnType<typeof setTimeout>;
    const request = Promise.race([
      Promise.resolve().then(() => read(path, target, inspect)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                inspect
                  ? 'Cleanup checks took too long. Your worktrees are still available. Refresh to retry.'
                  : 'Worktrees took too long to load. Refresh to retry.',
              ),
            ),
          inspect ? inspectionTimeout : listTimeout,
        );
      }),
    ]).finally(() => {
      clearTimeout(timer);
      pending.delete(key);
    });
    pending.set(key, request);
    return request;
  };
}

export const readWorktrees = createWorktreeReader();
