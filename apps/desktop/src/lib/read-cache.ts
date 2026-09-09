interface CachedRead<T> {
  value?: T;
  updatedAt: number;
  pending?: Promise<T>;
  controller: AbortController;
}

export function createReadCache<T>(ttl: number, limit = 24) {
  const entries = new Map<string, CachedRead<T>>();
  return {
    peek: (key: string) => entries.get(key)?.value,
    clear: () => {
      for (const entry of entries.values()) entry.controller.abort();
      entries.clear();
    },
    read: (key: string, loader: (signal: AbortSignal) => Promise<T>, force = false): Promise<T> => {
      const previous = entries.get(key);
      if (!force && previous) {
        if (previous.pending) return previous.pending;
        if (previous.value !== undefined && Date.now() - previous.updatedAt < ttl)
          return Promise.resolve(previous.value);
      }
      if (force) previous?.controller.abort();
      const entry: CachedRead<T> = {
        value: previous?.value,
        updatedAt: previous?.updatedAt ?? 0,
        controller: new AbortController(),
      };
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.get(oldest)?.controller.abort();
        entries.delete(oldest);
      }
      let pending: Promise<T>;
      try {
        pending = Promise.resolve(loader(entry.controller.signal));
      } catch (err) {
        pending = Promise.reject(err);
      }
      entry.pending = pending
        .then((value) => {
          if (!entry.controller.signal.aborted && entries.get(key) === entry) {
            entry.value = value;
            entry.updatedAt = Date.now();
          }
          return value;
        })
        .finally(() => {
          entry.pending = undefined;
        });
      return entry.pending;
    },
  };
}
