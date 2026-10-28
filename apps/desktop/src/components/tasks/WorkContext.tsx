import * as Dialog from '@radix-ui/react-dialog';
import { GitBranch } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { TaskRun } from '../../lib/task-runtime';
import { workSummary } from '../../lib/workbench';
import { useWorkbenchStore } from '../../stores/workbenchStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { NextWorkAction } from './NextWorkAction';
import { WorkTools } from './WorkTools';
import './workbench.css';

export function WorkContext({
  run,
  allowNavigation = true,
  onTerminal,
  hideTerminal = false,
}: {
  run: TaskRun;
  allowNavigation?: boolean;
  onTerminal?: () => void;
  /** The host shows its own Terminal tab, so the context row omits the button. */
  hideTerminal?: boolean;
}) {
  const { updated } = useWorkSeen(run);
  const requested = useWorkViewStore((state) =>
    state.request?.id === run.id && state.request.section === 'terminal'
      ? state.request.revision
      : undefined,
  );
  return (
    <section className="work-toolbar" aria-label="Task workspace">
      <span
        className="work-branch"
        title={`${run.projectName} · ${run.workspace || run.projectPath}`}
      >
        <GitBranch size={14} aria-hidden="true" />
        <span>{run.branch || 'Project checkout'}</span>
      </span>
      <div className="work-toolbar-actions">
        {updated && <span className="work-updated">Updated since last visit</span>}
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <Button variant="ghost">Task context</Button>
          </Dialog.Trigger>
          <DialogContent aria-describedby={undefined}>
            <DialogCloseButton />
            <DialogHeader title="Task context" />
            <WorkContextDetails run={run} allowNavigation={allowNavigation} />
          </DialogContent>
        </Dialog.Root>
        <WorkTools
          run={run}
          requestRevision={requested}
          onTerminal={onTerminal}
          hideTerminal={hideTerminal}
        />
      </div>
    </section>
  );
}

/** Records that the person has seen the run's current state once the window has focus. */
export function useWorkSeen(run?: TaskRun) {
  const summary = useMemo(() => (run ? workSummary(run) : undefined), [run]);
  const taskId = run?.taskId;
  const fingerprint = summary?.fingerprint;
  const seen = useMemo(
    () => (taskId ? useWorkbenchStore.getState().seen[taskId] : undefined),
    [taskId],
  );
  useEffect(() => {
    if (!taskId || !fingerprint) return;
    let timeout: ReturnType<typeof setTimeout>;
    const record = () => {
      clearTimeout(timeout);
      if (!document.hidden && document.hasFocus())
        timeout = setTimeout(
          () => useWorkbenchStore.getState().markSeen(taskId, fingerprint),
          2000,
        );
    };
    record();
    window.addEventListener('focus', record);
    window.addEventListener('blur', record);
    document.addEventListener('visibilitychange', record);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('focus', record);
      window.removeEventListener('blur', record);
      document.removeEventListener('visibilitychange', record);
    };
  }, [taskId, fingerprint]);
  return { updated: !!seen && seen !== fingerprint };
}

export function WorkContextDetails({
  run,
  allowNavigation = true,
}: {
  run: TaskRun;
  allowNavigation?: boolean;
}) {
  const summary = useMemo(() => workSummary(run), [run]);
  return (
    <div className="work-context-body">
      <p>
        <strong>{summary.decision.label}</strong> · {summary.decision.action}
      </p>
      {summary.question && <p>{summary.question}</p>}
      {summary.blocker && <p>{summary.blocker}</p>}
      <p>{summary.checks}</p>
      {run.branch && <p className="work-context-path">{run.branch}</p>}
      <p className="work-context-path">{run.workspace || run.projectPath}</p>
      {allowNavigation && <NextWorkAction run={run} />}
    </div>
  );
}
