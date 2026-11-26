import type { Metric } from '@jackalope/contracts/telemetry';

type Event = Metric & { id: string };

/** An event as the person can inspect it in Settings. Kept on this computer, never sent. */
export interface TelemetryLogEntry {
  event: Event;
  at: number;
  status: 'queued' | 'sent' | 'dropped';
}

const LOG_LIMIT = 100;

export function createTelemetry(send: (events: Event[]) => Promise<unknown>, delay = 15_000) {
  let enabled = false,
    errors = false,
    generation = 0,
    sending = false;
  let queue: { event: Event; attempts: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Replaced rather than mutated, so a snapshot reader sees each change.
  let log: TelemetryLogEntry[] = [];
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  const mark = (ids: Set<string>, status: TelemetryLogEntry['status']) => {
    if (!ids.size) return;
    log = log.map((entry) =>
      ids.has(entry.event.id) && entry.status === 'queued' ? { ...entry, status } : entry,
    );
    changed();
  };
  const dropQueued = () => mark(new Set(queue.map((entry) => entry.event.id)), 'dropped');
  const schedule = () => {
    if (!timer && enabled && queue.length)
      timer = setTimeout(
        () => {
          timer = undefined;
          void flush();
        },
        delay * 2 ** (queue[0]?.attempts ?? 0),
      );
  };
  const flush = async () => {
    if (!enabled || sending || !queue.length) return;
    clearTimeout(timer);
    timer = undefined;
    const batch = queue.splice(0, 50),
      epoch = generation;
    sending = true;
    try {
      await send(batch.map((entry) => entry.event));
      mark(new Set(batch.map((entry) => entry.event.id)), 'sent');
    } catch {
      const retry =
        epoch === generation && enabled
          ? batch
              .filter((entry) => entry.attempts < 2)
              .map((entry) => ({ ...entry, attempts: entry.attempts + 1 }))
          : [];
      const kept = [...retry, ...queue].slice(0, 50);
      const keptIds = new Set(kept.map((entry) => entry.event.id));
      mark(
        new Set(batch.map((entry) => entry.event.id).filter((id) => !keptIds.has(id))),
        'dropped',
      );
      if (epoch === generation && enabled) queue = kept;
    } finally {
      sending = false;
      schedule();
    }
  };
  return {
    configure(usage: boolean, failures: boolean) {
      if (enabled === usage && errors === failures) return;
      generation++;
      enabled = usage;
      errors = failures;
      clearTimeout(timer);
      timer = undefined;
      const kept = usage
        ? queue.filter((entry) => failures || entry.event.name !== 'app_error')
        : [];
      const keptIds = new Set(kept.map((entry) => entry.event.id));
      mark(
        new Set(queue.map((entry) => entry.event.id).filter((id) => !keptIds.has(id))),
        'dropped',
      );
      queue = kept;
      schedule();
    },
    track(metric: Metric) {
      if (!enabled || (metric.name === 'app_error' && !errors) || queue.length >= 50) return;
      const event = { ...metric, id: crypto.randomUUID() };
      queue.push({ event, attempts: 0 });
      log = [...log, { event, at: Date.now(), status: 'queued' as const }].slice(-LOG_LIMIT);
      changed();
      schedule();
    },
    flush,
    stop() {
      dropQueued();
      enabled = false;
      generation++;
      queue = [];
      clearTimeout(timer);
      timer = undefined;
    },
    /** The most recent events this session, newest last. */
    recent(): readonly TelemetryLogEntry[] {
      return log;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
