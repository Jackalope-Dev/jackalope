type Sample = { metric: string; milliseconds: number };
const samples: Sample[] = [];
let recording = false;
const nativeMetrics = new Set([
  'task_changes',
  'live_session_snapshot',
  'task_review',
  'task_verify',
  'task_start',
  'task_continue',
  'task_terminal_start',
  'task_work_window',
  'project_readiness',
]);
export function setPerformanceRecording(enabled: boolean) {
  recording = enabled;
}
export function isPerformanceRecording() {
  return recording;
}
export function clearPerformanceSamples() {
  samples.length = 0;
}
export function recordPerformance(metric: string, milliseconds: number) {
  if (!recording || !Number.isFinite(milliseconds) || milliseconds < 0) return;
  if (!nativeMetrics.has(metric) && !['ui-event', 'ui-long-task'].includes(metric)) return;
  samples.push({ metric, milliseconds });
  if (samples.length > 2000) samples.splice(0, samples.length - 2000);
}
export async function measureNative<T>(command: string, run: () => Promise<T>) {
  if (!recording || !nativeMetrics.has(command)) return run();
  const start = performance.now();
  try {
    return await run();
  } finally {
    recordPerformance(command, performance.now() - start);
  }
}
export function performanceSummary() {
  return [...new Set(samples.map((sample) => sample.metric))].map((metric) => {
    const times = samples
      .filter((sample) => sample.metric === metric)
      .map((sample) => sample.milliseconds)
      .sort((a, b) => a - b);
    return {
      metric,
      samples: times.length,
      medianMs: times[Math.ceil(times.length * 0.5) - 1],
      p95Ms: times[Math.ceil(times.length * 0.95) - 1],
      maxMs: times.at(-1),
    };
  });
}
export function observeWorkbenchPerformance() {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const observers: PerformanceObserver[] = [];
  for (const [type, metric] of [
    ['event', 'ui-event'],
    ['longtask', 'ui-long-task'],
  ]) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    const observer = new PerformanceObserver((list) => {
      if (document.hidden) return;
      for (const entry of list.getEntries()) recordPerformance(metric, entry.duration);
    });
    observer.observe({ type, durationThreshold: 16 } as PerformanceObserverInit);
    observers.push(observer);
  }
  return () => {
    for (const observer of observers) observer.disconnect();
  };
}
