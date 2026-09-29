import { useEffect, useRef } from 'react';

/** Listens for an app `CustomEvent` on window, passing its detail to the latest handler. */
export function useWindowEvent<T>(event: string, handler: (detail: T) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const handle = (value: Event) => latest.current((value as CustomEvent<T>).detail);
    window.addEventListener(event, handle);
    return () => window.removeEventListener(event, handle);
  }, [event]);
}
