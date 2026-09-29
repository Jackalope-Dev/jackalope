import { Textarea } from '@jackalope/ui';
import { ArrowRight } from 'lucide-react';
import { useRef } from 'react';
import { usePromptAttachments } from '../../hooks/usePromptAttachments';
import { appendAttachments } from '../../lib/prompt-attachments';
import type { TaskFollowUp } from '../../lib/task-followups';
import type { TaskRun } from '../../lib/task-runtime';
import { PROMPT_MAX_CHARS } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import { DismissButton } from '../ui/DismissButton';
import { InlineNotice } from '../ui/InlineNotice';
import { AttachButton } from './AttachButton';

/** The task's single follow-up composer with its queued follow-ups. */
export function TaskFollowUpPanel({
  run,
  active,
  integrated,
  canContinue,
  previewRunning,
  reply,
  followups,
  queueError,
  queueing,
  acting,
  submitting,
  onReply,
  onSend,
  onStopAndSend,
  onUpdate,
  onRecover,
}: {
  run: TaskRun;
  active: boolean;
  integrated: boolean;
  canContinue: boolean;
  previewRunning: boolean;
  reply: string;
  followups: TaskFollowUp[];
  queueError: string;
  queueing: boolean;
  acting: boolean;
  submitting: boolean;
  onReply: (text: string) => void;
  onSend: () => void;
  onStopAndSend: () => void;
  onUpdate: (id: string, action: 'resume' | 'cancel') => void;
  onRecover: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const agentName = useExecutionStore(
    (state) => state.runners.find((runner) => runner.id === run.agent)?.name ?? run.agent,
  );
  const attachments = usePromptAttachments({
    projectPath: run.projectPath,
    target: form,
    disabled: !canContinue,
    onAttach: (references) => onReply(appendAttachments(reply, references)),
  });
  return (
    <div className="task-next">
      <h2 className="task-followup-heading">{integrated ? 'Start a follow-up' : 'Follow-up'}</h2>
      {queueError && <InlineNotice tone="error">{queueError}</InlineNotice>}
      {followups.length > 0 && (
        <ul className="task-followup-queue" aria-label="Queued follow-ups">
          {followups.map((item) => (
            <li key={item.id}>
              <p>{item.prompt}</p>
              <div className="task-followup-footer">
                <p className="task-muted">
                  {item.error ??
                    (item.paused
                      ? 'Queue paused. Resume when ready.'
                      : 'Queued for the next attempt.')}
                </p>
                {item.paused && !item.runId && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={queueing}
                    onClick={() => onUpdate(item.id, 'resume')}
                  >
                    Resume
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={queueing}
                  onClick={() => onUpdate(item.id, 'cancel')}
                >
                  Cancel follow-up
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canContinue ? (
        <form
          ref={form}
          className="task-followup-form"
          data-dragging={attachments.dragging || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <Textarea
            id="task-reply"
            aria-label="Follow-up instructions"
            className="task-reply"
            rows={2}
            value={reply}
            onChange={(event) => onReply(event.target.value)}
            onPaste={attachments.onPaste}
            placeholder="Tell Jackalope what to do next…"
            maxLength={PROMPT_MAX_CHARS}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                onSend();
              }
            }}
          />
          {attachments.error && (
            <InlineNotice
              tone="error"
              action={<DismissButton onDismiss={attachments.clearError} />}
            >
              {attachments.error}
            </InlineNotice>
          )}
          <div className="task-followup-footer">
            {attachments.available && (
              <AttachButton
                onPick={() => void attachments.pick()}
                busy={attachments.busy}
                disabled={submitting || acting}
              />
            )}
            <p className="task-muted">
              {followups.length && previewRunning
                ? 'Queued follow-ups wait until the managed preview stops.'
                : previewRunning
                  ? 'Stops the managed preview, saves its logs, then continues in this workspace.'
                  : active
                    ? 'Queue for the next attempt, or stop current work and send now.'
                    : `Continues with ${agentName} in the same workspace and account.`}
            </p>
            {active && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  !reply.trim() || submitting || acting || queueing || run.status === 'stopping'
                }
                onClick={() => onStopAndSend()}
              >
                Stop &amp; send
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                !reply.trim() || submitting || acting || queueing || run.status === 'stopping'
              }
              loading={acting || submitting || queueing}
              loadingLabel={active || followups.length ? 'Queuing…' : 'Continuing…'}
            >
              {active || followups.length
                ? 'Queue follow-up'
                : previewRunning
                  ? 'Stop preview and continue'
                  : 'Continue task'}
              <ArrowRight size={15} />
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="task-muted mb-3">
            {run.status === 'interrupted'
              ? 'Inspect the agent session and workspace before starting more work; ownership could not be confirmed after interruption.'
              : integrated
                ? 'Start a new task from the updated target branch, with this result attached.'
                : active
                  ? 'A follow-up becomes available when the agent reports a resumable session.'
                  : 'This attempt has no resumable session. Carry its context into a new task to continue.'}
          </p>
          {!active && run.status !== 'interrupted' && (
            <Button variant="outline" onClick={onRecover}>
              Continue in a new task
            </Button>
          )}
        </>
      )}
    </div>
  );
}
