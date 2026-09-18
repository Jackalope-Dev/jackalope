import * as Dialog from '@radix-ui/react-dialog';
import { GitBranch } from 'lucide-react';
import { type ReactNode, useEffect, useMemo } from 'react';
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
  children,
}: {
  run: TaskRun;
  allowNavigation?: boolean;
  children?: ReactNode;
}) {
  const summary = useMemo(() => workSummary(run), [run]);
  const requested = useWorkViewStore((state) =>
    state.request?.id === run.id && state.request.section === 'terminal'
      ? state.request.revision
      : undefined,
  );
  const seen = useMemo(() => useWorkbenchStore.getState().seen[run.taskId], [run.taskId]);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const record = () => {
      clearTimeout(timeout);
      if (!document.hidden && document.hasFocus())
        timeout = setTimeout(
          () => useWorkbenchStore.getState().markSeen(run.taskId, summary.fingerprint),
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
  }, [run.taskId, summary.fingerprint]);
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
        {seen && seen !== summary.fingerprint && (
          <span className="work-updated">Updated since last visit</span>
        )}
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <Button variant="ghost">Task context</Button>
          </Dialog.Trigger>
          <DialogContent aria-describedby={undefined}>
            <DialogCloseButton />
            <DialogHeader title="Task context" />
            <div className="work-context-body">
              <p>
                <strong>{summary.decision.label}</strong> · {summary.decision.action}
              </p>
              {summary.question && <p>{summary.question}</p>}
              {summary.blocker && <p>{summary.blocker}</p>}
              <p>{summary.checks}</p>
              <p className="work-context-path">{run.workspace || run.projectPath}</p>
              {allowNavigation && <NextWorkAction run={run} />}
            </div>
          </DialogContent>
        </Dialog.Root>
        {children}
        <WorkTools run={run} requestRevision={requested} />
      </div>
    </section>
  );
}
