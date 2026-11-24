import { Button, InlineNotice, Textarea } from '@jackalope/ui';
import { ArrowRight } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePromptAttachments } from '../../hooks/usePromptAttachments';
import { useProviderSkills } from '../../hooks/useProviderSkills';
import { agentAdapter, getAgentMetadata } from '../../lib/agent-catalog';
import { emitAppEvent } from '../../lib/app-events';
import { type ComposerCommand, composingKey } from '../../lib/composer-commands';
import { insertDictation, placeCaret } from '../../lib/dictation';
import { appendAttachments } from '../../lib/prompt-attachments';
import { isReasoningEffort, type ReasoningEffort } from '../../lib/reasoning-effort';
import type { TaskRun } from '../../lib/run-types';
import { PROMPT_MAX_CHARS } from '../../lib/run-types';
import type { TaskFollowUp } from '../../lib/task-followups';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { ComposerEffortPicker, useEffortLevels } from '../composer/ComposerEffortPicker';
import { ContextMeter } from '../composer/ContextMeter';
import { PastedTextChips } from '../composer/PastedTextChips';
import { SideQuestion } from '../composer/SideQuestion';
import { useComposerAssist } from '../composer/useComposerAssist';
import { ActionError } from '../ui/ActionError';
import { DismissButton } from '../ui/DismissButton';
import { VoiceButton } from '../voice/VoiceButton';
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
  effort: savedEffort,
  onEffort,
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
  /** The effort level chosen for the next follow-up, kept with the reply draft. */
  effort: string | null;
  onEffort: (value: ReasoningEffort | null) => void;
  onSend: () => void;
  onStopAndSend: () => void;
  onUpdate: (id: string, action: 'resume' | 'cancel') => void;
  onRecover: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const replyField = useRef<HTMLTextAreaElement>(null);
  const agentName = useExecutionStore(
    (state) =>
      state.runners.find((runner) => runner.id === run.agent)?.name ??
      getAgentMetadata(run.agent)?.name ??
      run.agent,
  );
  const latestReply = useRef(reply);
  latestReply.current = reply;
  const edit = (change: (current: string) => string) => {
    onReply(change(latestReply.current));
    replyField.current?.focus();
  };
  const attachments = usePromptAttachments({
    projectPath: run.projectPath,
    target: form,
    disabled: !canContinue,
    onAttach: (references) => edit((current) => appendAttachments(current, references)),
    edit,
    room: () => PROMPT_MAX_CHARS - [...latestReply.current].length,
  });
  const effort = isReasoningEffort(savedEffort) ? savedEffort : null;
  const efforts = useEffortLevels(run.projectId, run.agent, run.model ?? undefined);
  const [effortOpen, setEffortOpen] = useState(false);
  const [side, setSide] = useState<{ id: string; text: string } | null>(null);
  const prompts = useExecutionStore(
    useShallow((state) =>
      state.runs
        .filter((item) => item.taskId === run.taskId)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((item) => item.prompt),
    ),
  );
  const history = useMemo(
    () => [...prompts, ...followups.map((item) => item.prompt)],
    [prompts, followups],
  );
  const customAgents = useAgentConfigStore((state) => state.customAgents);
  const skills = useProviderSkills(agentAdapter(run.agent, customAgents), run.projectId);
  const commands = useMemo(
    () => ({ effort: efforts.levels.length > 0, clear: true, btw: true, provider: skills }),
    [efforts.levels.length, skills],
  );
  const assist = useComposerAssist({
    input: replyField,
    text: reply,
    setText: onReply,
    projectPath: run.projectPath,
    history,
    commands,
    disabled: !canContinue,
    run: (command: ComposerCommand, argument: string) => {
      if (command.id === 'effort') setEffortOpen(true);
      else if (command.id === 'clear') emitAppEvent('new-work', run.projectId);
      else if (command.id === 'btw') setSide({ id: crypto.randomUUID(), text: argument });
    },
  });
  const send = () => {
    if (assist.intercept(reply.trim())) return;
    assist.sent();
    onSend();
  };
  return (
    <div className="task-next">
      <h2 className="task-followup-heading">{integrated ? 'Start a follow-up' : 'Follow-up'}</h2>
      <ActionError error={queueError} />
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
        // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer convenience; the field and buttons stay reachable by keyboard
        <form
          ref={form}
          className="task-followup-form"
          data-dragging={attachments.dragging || undefined}
          onClick={(event) => {
            // The card reads as the field, so a click on its padding focuses the draft.
            if (event.target === event.currentTarget) replyField.current?.focus();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {assist.menu}
          {side && (
            <SideQuestion
              run={run}
              question={side}
              onClose={() => {
                setSide(null);
                replyField.current?.focus();
              }}
              onInsert={(answer) => {
                edit((current) => (current.trim() ? `${current.trimEnd()}\n\n${answer}` : answer));
                setSide(null);
              }}
            />
          )}
          <Textarea
            ref={replyField}
            {...assist.fieldProps}
            id="task-reply"
            aria-label="Follow-up instructions"
            className="task-reply"
            rows={2}
            value={reply}
            onChange={(event) => onReply(event.target.value)}
            onPaste={attachments.onPaste}
            placeholder="Tell Jackalope what to do next, / for commands, @ for files…"
            maxLength={PROMPT_MAX_CHARS}
            onKeyDown={(event) => {
              if (assist.onKeyDown(event)) return;
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key === 'Enter' &&
                !composingKey(event.nativeEvent)
              ) {
                event.preventDefault();
                send();
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
            <VoiceButton
              disabled={submitting || acting}
              onText={(value) => {
                const next = insertDictation(reply, value, replyField.current);
                onReply(next.text);
                placeCaret(replyField.current, next.caret);
              }}
            />
            <ContextMeter run={run} />
            <ComposerEffortPicker
              levels={efforts.levels}
              loaded={efforts.loaded}
              value={effort}
              onChange={onEffort}
              open={effortOpen}
              onOpenChange={(open) => {
                setEffortOpen(open);
                if (!open) replyField.current?.focus();
              }}
              disabled={submitting || acting}
            />
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
          <PastedTextChips
            pasted={attachments.pasted}
            onUndo={attachments.undoPaste}
            onDismiss={attachments.dismissPaste}
          />
        </form>
      ) : (
        <>
          <p className="task-muted mb-3">
            {run.status === 'interrupted'
              ? 'Jackalope closed before this attempt finished. Resume it to send follow-ups.'
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
