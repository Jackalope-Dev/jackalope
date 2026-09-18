import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalProgress } from './local-ai';
import { nativeTask } from './task-runtime';

export function useManagedRuntime() {
  const operation = useRef<{ id: string; canceled: boolean; started: boolean } | null>(null);
  const alive = useRef(true);
  const [progress, setProgress] = useState<LocalProgress | null>(null);
  const [preparing, setPreparing] = useState(false);
  const cancel = useCallback(async () => {
    const current = operation.current;
    if (!current) return;
    current.canceled = true;
    if (current.started) await nativeTask('managed_runtime_cancel', { operationId: current.id });
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
    const current = { id: crypto.randomUUID(), canceled: false, started: false };
    operation.current = current;
    setPreparing(true);
    setProgress(null);
    try {
      const { Channel } = await import('@tauri-apps/api/core');
      if (!alive.current) throw new Error('Setup closed. Reopen it to continue.');
      if (current.canceled) throw new Error('Runner setup canceled.');
      const channel = new Channel<LocalProgress>();
      channel.onmessage = (event) => {
        if (alive.current) setProgress(event);
      };
      current.started = true;
      await nativeTask('managed_runtime_prepare', {
        operationId: current.id,
        useConfigured,
        progress: channel,
      });
      if (current.canceled) throw new Error('Runner setup canceled.');
      if (!alive.current) throw new Error('Setup closed. Reopen it to continue.');
    } finally {
      operation.current = null;
      if (alive.current) setPreparing(false);
    }
  };
  return { prepare, cancel, preparing, progress };
}
