import type { Metric } from '@jackalope/contracts/telemetry';

type Event = Metric & { id: string };
export function createTelemetry(send: (events: Event[]) => Promise<unknown>, delay = 15_000) {
  let enabled = false,
    errors = false,
    generation = 0,
    sending = false;
  let queue: { event: Event; attempts: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
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
    } catch {
      if (epoch === generation && enabled) {
        const retry = batch
          .filter((entry) => entry.attempts < 2)
          .map((entry) => ({ ...entry, attempts: entry.attempts + 1 }));
        queue = [...retry, ...queue].slice(0, 50);
      }
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
      queue = usage ? queue.filter((entry) => failures || entry.event.name !== 'app_error') : [];
      schedule();
    },
    track(metric: Metric) {
      if (!enabled || (metric.name === 'app_error' && !errors) || queue.length >= 50) return;
      queue.push({ event: { ...metric, id: crypto.randomUUID() }, attempts: 0 });
      schedule();
    },
    flush,
    stop() {
      enabled = false;
      generation++;
      queue = [];
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
