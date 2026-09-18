import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalProgress } from './local-ai';
import { nativeTask } from './task-runtime';

export function useManagedRuntime() {
  const operation = useRef<string | null>(null);
  const alive = useRef(true);
  const [progress, setProgress] = useState<LocalProgress | null>(null);
  const [preparing, setPreparing] = useState(false);
  const cancel = useCallback(async () => {
    if (operation.current)
      await nativeTask('managed_runtime_cancel', { operationId: operation.current });
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void cancel().catch(() => {});
    };
  }, [cancel]);
  const prepare = async (useConfigured = true) => {
    if (operation.current) throw new Error('Runner setup is already running.');
    setPreparing(true);
    setProgress(null);
    try {
      const { Channel } = await import('@tauri-apps/api/core');
      if (!alive.current) throw new Error('Setup closed. Reopen it to continue.');
      const channel = new Channel<LocalProgress>();
      channel.onmessage = (event) => {
        if (alive.current) setProgress(event);
      };
      operation.current = crypto.randomUUID();
      await nativeTask('managed_runtime_prepare', {
        operationId: operation.current,
        useConfigured,
        progress: channel,
      });
      if (!alive.current) throw new Error('Setup closed. Reopen it to continue.');
    } finally {
      operation.current = null;
      if (alive.current) setPreparing(false);
    }
  };
  return { prepare, cancel, preparing, progress };
}
