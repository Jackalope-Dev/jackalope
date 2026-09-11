import { useEffect, useState } from 'react';
import { nativeTask, type TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

interface Preview {
  port: number;
  command: string;
  running: boolean;
  output: string;
  exitCode: number | null;
}

export function TaskPreview({ run }: { run: TaskRun }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [command, setCommand] = useState('');
  const [port, setPort] = useState(5173);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const value = await nativeTask<Preview | null>('task_preview_status', { id: run.id });
        if (alive) setPreview(value);
      } catch (cause) {
        if (alive) setError(String(cause));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [run.id]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="my-4">
      <summary className="min-h-11 py-3">
        Try the result in a local preview{preview?.running ? ' · Process running' : ''}
      </summary>
      <div className="space-y-3">
        <p className="task-muted">
          Start a preview in this task's workspace. Keep the server bound to localhost and use{' '}
          {'{port}'} for its port argument. Jackalope stops only the process tree it starts.
        </p>
        <label className="block" htmlFor="preview-command">
          Preview command
          <input
            id="preview-command"
            className="task-input w-full"
            maxLength={4000}
            value={command}
            disabled={busy || preview?.running}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="pnpm run dev -- --port {port} --host 127.0.0.1"
          />
        </label>
        <label className="block" htmlFor="preview-port">
          Port
          <input
            id="preview-port"
            className="task-input w-full"
            type="number"
            min={1024}
            max={65535}
            value={port}
            disabled={busy || preview?.running}
            onChange={(e) => setPort(Number(e.target.value))}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {preview ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await nativeTask('task_preview_stop', { id: run.id });
                    setPreview(null);
                  })
                }
              >
                {preview.running ? 'Stop preview' : 'Save logs and clear preview'}
              </Button>
              {preview.running && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void act(async () => {
                      const { open } = await import('@tauri-apps/plugin-shell');
                      await open(`http://127.0.0.1:${preview.port}`);
                    })
                  }
                >
                  Open preview address
                </Button>
              )}
            </>
          ) : (
            <Button
              disabled={
                busy ||
                !command.includes('{port}') ||
                !Number.isInteger(port) ||
                port < 1024 ||
                port > 65535
              }
              onClick={() =>
                void act(async () =>
                  setPreview(
                    await nativeTask<Preview>('task_preview_start', { id: run.id, command, port }),
                  ),
                )
              }
            >
              Start preview
            </Button>
          )}
        </div>
        {preview && (
          <>
            <p className="task-muted">
              {preview.running
                ? 'Process running; inspect the logs before opening the address. Server readiness and correctness have not been verified.'
                : `Preview exited (${preview.exitCode ?? 'unknown exit code'}). Inspect its output below.`}
            </p>
            <pre className="task-input whitespace-pre-wrap break-words max-h-64 overflow-auto">
              {preview.output || 'No output yet.'}
            </pre>
          </>
        )}
        <p className="task-muted">
          Stop the preview before continuing, merging or removing this workspace. Stopping saves its
          bounded logs in task diagnostics. Closing this panel leaves it running; exiting the app
          stops it.
        </p>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </div>
    </details>
  );
}
