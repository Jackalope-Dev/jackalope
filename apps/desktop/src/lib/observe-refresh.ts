export function observeRefresh({
  refresh,
  interval,
  subscribe,
}: {
  refresh: () => Promise<void>;
  interval: () => number;
  subscribe?: (changed: () => void) => Promise<() => void>;
}) {
  let disposed = false;
  let running = false;
  let pending = false;
  let scheduledEvent = false;
  let timer: ReturnType<typeof setTimeout>;
  let unsubscribe: (() => void) | undefined;
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(tick, delay);
  };
  const tick = async () => {
    if (disposed) return;
    if (running) {
      pending = true;
      return;
    }
    scheduledEvent = false;
    running = true;
    try {
      await refresh();
    } finally {
      running = false;
      schedule(pending ? 100 : interval());
      pending = false;
    }
  };
  const changed = () => {
    if (running) pending = true;
    else if (!scheduledEvent) {
      scheduledEvent = true;
      schedule(100);
    }
  };
  const focus = () => {
    if (!document.hidden) changed();
  };
  window.addEventListener('focus', focus);
  document.addEventListener('visibilitychange', focus);
  void subscribe?.(changed)
    .then((stop) => {
      if (disposed) stop();
      else unsubscribe = stop;
    })
    .catch(() => {});
  void tick();
  return () => {
    disposed = true;
    clearTimeout(timer);
    unsubscribe?.();
    window.removeEventListener('focus', focus);
    document.removeEventListener('visibilitychange', focus);
  };
}
