import { describeError } from '@jackalope/contracts/errors';
import { type DependencyList, useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  /** Reload on this interval while mounted. */
  pollMs?: number;
  /** Skip loading (and polling) while false. */
  enabled?: boolean;
}

/**
 * Loads data when `deps` change and optionally polls it. Results that arrive after the deps
 * changed or the component unmounted are dropped. Data is reset when the deps change.
 */
export function useNativeResource<T>(
  load: () => Promise<T>,
  deps: DependencyList,
  { pollMs, enabled = true }: Options = {},
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async (): Promise<T | undefined> => {
    const id = generation.current;
    try {
      const next = await loadRef.current();
      if (id !== generation.current) return undefined;
      setData(next);
      setError('');
      return next;
    } catch (cause) {
      if (id === generation.current) setError(describeError(cause));
      return undefined;
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    generation.current++;
    setData(undefined);
    setError('');
    setLoading(enabled);
    if (!enabled) return;
    void reload();
    const timer = pollMs ? window.setInterval(() => void reload(), pollMs) : undefined;
    return () => {
      generation.current++;
      window.clearInterval(timer);
    };
  }, [...deps, enabled, pollMs, reload]);
  return { data, error, loading, reload, setData, setError };
}
