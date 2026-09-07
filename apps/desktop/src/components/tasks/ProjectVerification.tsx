import { useState } from 'react';
import { nativeTask, type TaskRun, type Verification } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';

export function ProjectVerification({ run, command }: { run: TaskRun; command?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Verification | null>(null);
  const check =
    run.verification && (!result || run.verification.checkedAt >= result.checkedAt)
      ? run.verification
      : result;
  const selected = run.verifyCommand || command;
  const verify = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      setResult(await nativeTask<Verification>('task_verify', { id: run.id, command: selected }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      await useExecutionStore.getState().refresh();
      setBusy(false);
    }
  };
  return (
    <section className="mt-5 space-y-3" aria-label="Project verification">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Check your changes</h3>
          <p className="task-muted mt-1">
            {selected
              ? 'Runs in this task’s workspace with a five-minute limit. Install project dependencies first.'
              : 'Set a verification command in Project Settings to run and record your checks here.'}
          </p>
          {selected && <code className="block text-xs mt-2 break-all">{selected}</code>}
        </div>
        {selected && (
          <Button variant="outline" disabled={busy} onClick={() => void verify()}>
            {busy ? 'Checking…' : 'Run checks'}
          </Button>
        )}
      </div>
      {run.verificationError && !check && (
        <p role="alert" className="task-error">
          Automatic checks could not finish: {run.verificationError}
        </p>
      )}
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      {check ? (
        <div className="space-y-2">
          <p
            role="status"
            className={
              check.result.success && check.tree && !run.persistenceError
                ? 'text-[var(--color-success)]'
                : 'text-[var(--color-warning)]'
            }
          >
            {run.persistenceError
              ? 'Task history has unsaved changes. Save it before integrating.'
              : check.result.timedOut
                ? 'Checks timed out; command processes were stopped.'
                : !check.result.success
                  ? `Checks failed (exit ${check.result.exitCode ?? 'unknown'}).`
                  : !check.tree
                    ? 'Command passed, but files changed during the check. Run it again.'
                    : 'Checks passed for the recorded file snapshot.'}
          </p>
          <p className="task-muted text-xs">
            {new Date(check.checkedAt).toLocaleString()} ·{' '}
            {(check.result.durationMs / 1000).toFixed(1)} seconds. File changes require another
            check.
          </p>
          <details>
            <summary className="task-summary">Read verification output</summary>
            {check.result.truncated && (
              <p className="task-muted">Output was shortened to keep this view responsive.</p>
            )}
            <pre className="task-output mt-2">
              {check.result.stdout}
              {'\n'}
              {check.result.stderr}
            </pre>
          </details>
        </div>
      ) : (
        <p className="task-muted text-xs">No project checks recorded for this attempt.</p>
      )}
    </section>
  );
}
