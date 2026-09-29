import { isActive, type TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

/** A commit refused by a hook, with the output needed to fix it. */
export interface HookFailure {
  hook: string | null;
  message: string;
  output: string;
  files: string[];
}

export function failureOf(cause: unknown): {
  kind: string;
  hook?: string | null;
  message: string;
  output?: string;
} {
  if (cause && typeof cause === 'object' && 'kind' in cause && 'message' in cause)
    return cause as { kind: string; hook?: string | null; message: string; output?: string };
  return { kind: 'git', message: cause instanceof Error ? cause.message : String(cause) };
}

export function HookFixStatus({
  run,
  agentName,
  onStop,
  onCommit,
  canCommit,
  onOpen,
  onDismiss,
}: {
  run: TaskRun;
  agentName: string;
  onStop: () => void;
  onCommit: () => void;
  canCommit: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const open = (
    <Button variant="ghost" onClick={onOpen}>
      Open task
    </Button>
  );
  if (isActive(run)) {
    const detail = run.progress?.detail || run.activity.at(-1) || '';
    return (
      <InlineNotice
        tone="info"
        role="status"
        className="commit-review-notice"
        action={
          <div className="commit-hook-fix-actions">
            {open}
            <Button variant="outline" onClick={onStop} disabled={run.status === 'stopping'}>
              {run.status === 'stopping' ? 'Stopping…' : 'Stop'}
            </Button>
          </div>
        }
      >
        <p>
          <strong>{agentName || 'An agent'}</strong> is fixing the hook failure in this checkout
          {run.progress?.label ? ` · ${run.progress.label}` : '…'}
        </p>
        {detail && <p className="commit-hook-fix-detail">{detail}</p>}
      </InlineNotice>
    );
  }
  if (run.status === 'review' || run.status === 'reviewed')
    return (
      <InlineNotice
        tone="success"
        role="status"
        className="commit-review-notice"
        action={
          <div className="commit-hook-fix-actions">
            {open}
            <Button variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
            <Button onClick={onCommit} disabled={!canCommit}>
              Commit again
            </Button>
          </div>
        }
      >
        <p>{agentName || 'The agent'} finished. Review its changes below, then commit again.</p>
      </InlineNotice>
    );
  return (
    <InlineNotice
      tone={run.status === 'stopped' ? 'warning' : 'error'}
      className="commit-review-notice"
      action={
        <div className="commit-hook-fix-actions">
          {open}
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      }
    >
      <p>
        {run.status === 'stopped'
          ? 'The fix was stopped. Anything the agent already changed is still in your checkout.'
          : run.error || 'The agent could not finish the fix. Open the task to see what happened.'}
      </p>
    </InlineNotice>
  );
}
