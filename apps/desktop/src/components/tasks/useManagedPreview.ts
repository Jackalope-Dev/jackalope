import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';

export function useManagedPreview(id: string | undefined, enabled: boolean) {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    setRunning(false);
    if (!id || !enabled) return;
    let alive = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const preview = await nativeTask<{ running: boolean } | null>('task_preview_status', {
          id,
        });
        if (alive) setRunning(preview?.running ?? false);
      } catch {
        // The preview panel exposes inspection errors; continuation still has its native ownership guard.
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, enabled]);
  return running;
}
