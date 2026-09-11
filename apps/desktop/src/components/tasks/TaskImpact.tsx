import { useEffect, useRef, useState } from 'react';
import { scanCodebase } from '../../lib/codebase';
import { affectedFiles } from '../../lib/codebase-impact';
import type { TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function TaskImpact({ run, files }: { run: TaskRun; files: string[] }) {
  const [affected, setAffected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [time, setTime] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, []);
  const scan = async () => {
    const current = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const snapshot = await scanCodebase(run.workspace);
      if (generation.current !== current) return;
      setAffected(affectedFiles(snapshot, files));
      setTime(snapshot.scannedAt);
      if (snapshot.truncated) setError('The scan reached its limit; impact coverage is partial.');
    } catch (cause) {
      if (generation.current === current) setError(String(cause));
    } finally {
      if (generation.current === current) setBusy(false);
    }
  };
  return (
    <section className="mt-5">
      <Button variant="outline" disabled={busy || !files.length} onClick={() => void scan()}>
        {busy ? 'Tracing references…' : 'Check affected files'}
      </Button>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {affected && (
        <section className="mt-3">
          <h3 className="text-base font-medium">{affected.length} files depend on these changes</h3>
          <p className="task-muted">
            Based on supported imports in this task's workspace at{' '}
            {new Date(time).toLocaleTimeString()}. Deleted modules, dynamic links and runtime
            behavior may be missing. Run the project checks before integration.
          </p>
          {affected.slice(0, 200).map((file) => (
            <p key={file} className="font-mono text-xs break-all py-1">
              {file}
            </p>
          ))}
          {affected.length > 200 && (
            <p className="task-muted">Showing the first 200 affected files.</p>
          )}
        </section>
      )}
    </section>
  );
}
