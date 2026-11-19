import { Button, ConfirmDialog, FormField, InlineNotice, Textarea } from '@jackalope/ui';
import { useState } from 'react';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { PROMPT_MAX_CHARS, type TaskRun } from '../../lib/run-types';
import {
  releaseInterrupted,
  type WorkspaceProcess,
  workspaceProcesses,
} from '../../lib/task-client';
import './resume-interrupted.css';

/** What a resumed agent is told before anything the person adds. */
const RESUME_PROMPT =
  'Jackalope restarted while you were working, so your last steps may not have finished and processes you started in the background may have stopped. Check the workspace, then continue where you left off.';

/** The continuation prompt for resuming with the person's optional `instructions`. */
export function resumePrompt(instructions: string) {
  return [RESUME_PROMPT, instructions.trim()].filter(Boolean).join('\n\n');
}

/** Lists anything still running in an interrupted attempt's workspace, checked when its dialog opens. */
function useLeftoverProcesses(run: TaskRun) {
  const [checking, setChecking] = useState(false);
  const [processes, setProcesses] = useState<WorkspaceProcess[] | null>([]);
  const check = () => {
    setChecking(true);
    void workspaceProcesses(run.id)
      .then(setProcesses)
      .catch(() => setProcesses(null))
      .finally(() => setChecking(false));
  };
  const notice = checking ? (
    <p role="status" className="task-muted">
      Checking the workspace for anything still running…
    </p>
  ) : processes === null ? (
    <InlineNotice tone="warning">
      Jackalope can’t check for leftover processes on this system. Make sure nothing this attempt
      started is still running first.
    </InlineNotice>
  ) : processes.length ? (
    <InlineNotice
      tone="warning"
      action={
        <Button variant="outline" onClick={check}>
          Check again
        </Button>
      }
    >
      <p>
        Still running in this workspace. Stop anything this attempt started, such as a dev server,
        so it doesn’t clash with later work.
      </p>
      <ul className="resume-processes">
        {processes.map((process) => (
          <li key={process.pid}>
            <code>{process.name || 'Unnamed process'}</code> · process {process.pid}
          </li>
        ))}
      </ul>
    </InlineNotice>
  ) : (
    <p className="task-muted">Nothing is running in this workspace.</p>
  );
  return { check, notice };
}

/**
 * Resumes an attempt Jackalope was closed during. The dialog lists anything still running in
 * the workspace so the person can confirm nothing from the attempt is left before `onResume`
 * releases it and picks the work back up.
 */
export function ResumeInterrupted({
  id,
  run,
  variant = 'primary',
  disabled = false,
  onResume,
}: {
  id?: string;
  run: TaskRun;
  variant?: 'primary' | 'outline';
  disabled?: boolean;
  /** Releases the attempt and continues it; `instructions` is empty when none were added. */
  onResume: (instructions: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const leftovers = useLeftoverProcesses(run);
  const agent = getAgentMetadata(run.agent)?.name ?? run.agent;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) leftovers.check();
      }}
      trigger={
        <Button id={id} variant={variant} disabled={disabled}>
          Resume
        </Button>
      }
      title="Resume interrupted work"
      description={
        run.sessionId
          ? `Jackalope closed before ${agent} finished. Resuming continues its conversation in the same workspace.`
          : `Jackalope closed before ${agent} finished and it left no conversation to continue, so this starts the work again in the same workspace.`
      }
      label="Resume"
      busyLabel="Resuming…"
      variant="primary"
      onConfirm={() => onResume(run.sessionId ? instructions : '')}
    >
      <div className="resume-interrupted">
        {leftovers.notice}
        {run.sessionId && (
          <FormField label="Instructions (optional)">
            <Textarea
              rows={2}
              maxLength={PROMPT_MAX_CHARS}
              value={instructions}
              placeholder="Anything to do differently this time…"
              onChange={(event) => setInstructions(event.target.value)}
            />
          </FormField>
        )}
      </div>
    </ConfirmDialog>
  );
}

/**
 * Marks an interrupted attempt stopped without rerunning it, after the same leftover-process
 * check, so it stops holding its workspace (and blocking updates) but can still be continued
 * or retried later.
 */
export function StopInterrupted({
  run,
  disabled = false,
  onStopped,
}: {
  run: TaskRun;
  disabled?: boolean;
  onStopped?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const leftovers = useLeftoverProcesses(run);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) leftovers.check();
      }}
      trigger={
        <Button variant="outline" disabled={disabled}>
          Mark stopped
        </Button>
      }
      title="Mark interrupted work stopped"
      description="Nothing is rerun and the workspace stays as it is. You can continue or retry this task later."
      label="Mark stopped"
      busyLabel="Marking stopped…"
      variant="primary"
      onConfirm={async () => {
        await releaseInterrupted(run.id);
        await onStopped?.();
      }}
    >
      <div className="resume-interrupted">{leftovers.notice}</div>
    </ConfirmDialog>
  );
}
