import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
import { isTauriEnvironment } from '../lib/tauri-bridge';

/**
 * Subscribes to a native event for the component's lifetime. The latest
 * handler always runs, so callers need not memoize it, and a listener that
 * resolves after unmount is removed immediately. A no-op outside Tauri.
 */
export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<T>(event, ({ payload }) => latest.current(payload)).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [event]);
}
