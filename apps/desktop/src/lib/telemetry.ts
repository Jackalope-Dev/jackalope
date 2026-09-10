export type Feature =
  | 'tasks'
  | 'worktrees'
  | 'agents'
  | 'usage'
  | 'codebase'
  | 'settings'
  | 'connections'
  | 'schedules'
  | 'browser'
  | 'queue';
export type ErrorCode =
  | 'history_save_failed'
  | 'verification_failed'
  | 'update_failed'
  | 'ui_error'
  | 'task_failed';
export type TaskState =
  | 'starting'
  | 'running'
  | 'review'
  | 'reviewed'
  | 'failed'
  | 'stopped'
  | 'interrupted';
export type Metric =
  | { name: 'app_opened' }
  | { name: 'feature_used'; feature: Feature }
  | { name: 'app_error'; code: ErrorCode }
  | { name: 'task_state'; state: TaskState };
type Event = Metric & { id: string };
export function createTelemetry(send: (events: Event[]) => Promise<unknown>, delay = 15_000) {
  let enabled = false,
    errors = false,
    generation = 0,
    retries = 0,
    sending = false;
  let queue: Event[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!timer && enabled && queue.length)
      timer = setTimeout(
        () => {
          timer = undefined;
          void flush();
        },
        delay * 2 ** retries,
      );
  };
  const flush = async () => {
    if (!enabled || sending || !queue.length) return;
    const batch = queue.splice(0, 50),
      epoch = generation;
    sending = true;
    try {
      await send(batch);
      retries = 0;
    } catch {
      if (epoch === generation && enabled && retries < 2) {
        queue = [...batch, ...queue].slice(0, 50);
        retries++;
      } else retries = 0;
    } finally {
      sending = false;
      schedule();
    }
  };
  return {
    configure(usage: boolean, failures: boolean) {
      generation++;
      enabled = usage;
      errors = failures;
      retries = 0;
      clearTimeout(timer);
      timer = undefined;
      queue = usage ? queue.filter((e) => failures || e.name !== 'app_error') : [];
      schedule();
    },
    track(metric: Metric) {
      if (!enabled || (metric.name === 'app_error' && !errors) || queue.length >= 50) return;
      queue.push({ ...metric, id: crypto.randomUUID() });
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
