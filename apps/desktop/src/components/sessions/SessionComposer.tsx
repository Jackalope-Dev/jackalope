import { describeError } from '@jackalope/contracts/errors';
import { isRunning } from '@jackalope/contracts/runs';
import { BorderBeamLayer, Button, InlineNotice, Textarea } from '@jackalope/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePromptAttachments } from '../../hooks/usePromptAttachments';
import { useProviderSkills } from '../../hooks/useProviderSkills';
import { agentAdapter } from '../../lib/agent-catalog';
import { emitAppEvent } from '../../lib/app-events';
import { type ComposerCommand, composingKey } from '../../lib/composer-commands';
import { insertDictation, placeCaret } from '../../lib/dictation';
import { type LiveSession, type SessionDraft, sessionCommand } from '../../lib/live-session';
import { appendAttachments } from '../../lib/prompt-attachments';
import { type ReasoningEffort, savedEffort, saveEffort } from '../../lib/reasoning-effort';
import { appendFeedbackDraft } from '../../lib/review-feedback';
import type { TaskRun } from '../../lib/run-types';
import { stopAndSettle, stopPreview } from '../../lib/task-client';
import { windowKind } from '../../lib/window-kind';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { ComposerEffortPicker, useEffortLevels } from '../composer/ComposerEffortPicker';
import { ContextMeter } from '../composer/ContextMeter';
import { PastedTextChips } from '../composer/PastedTextChips';
import { SideQuestion } from '../composer/SideQuestion';
import { useComposerAssist } from '../composer/useComposerAssist';
import { useComposerKeybindings } from '../composer/useComposerKeybindings';
import { AttachButton } from '../tasks/AttachButton';
import { useManagedPreview } from '../tasks/useManagedPreview';
import { DismissButton } from '../ui/DismissButton';
import { VoiceButton } from '../voice/VoiceButton';

export function SessionComposer({
  session,
  onSent,
  active,
  latestRun,
  addition,
}: {
  session: LiveSession;
  onSent: () => Promise<void>;
  active?: TaskRun;
  latestRun?: TaskRun;
  addition?: { text: string; revision: number; applied: (error?: string) => void };
}) {
  const key = `jackalope-live-draft:${windowKind().kind === 'liveSession' ? 'window' : 'main'}:${session.id}`;
  const previewRunning = useManagedPreview(latestRun?.id, !active);
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) ?? session.draft.text;
    } catch {
      return session.draft.text;
    }
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const revision = useRef(session.draft.revision);
  const saved = useRef(session.draft.text);
  const pending = useRef<{ id: string; text: string } | null>(null);
  const sending = useRef(false);
  const draftSave = useRef<Promise<void> | null>(null);
  const editing = useRef(text !== session.draft.text);
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(text);
  latest.current = text;
  const added = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  const edit = (change: (current: string) => string) => {
    editing.current = true;
    setText(change);
    input.current?.focus();
  };
  const attachments = usePromptAttachments({
    projectPath: session.request.projectPath,
    target: form,
    disabled: session.closed,
    onAttach: (references) => edit((current) => appendAttachments(current, references)),
    edit,
    room: () => 12000 - [...latest.current].length,
  });
  const effortKey = `jackalope-live-effort:${session.id}`;
  const [effort, setEffortState] = useState<ReasoningEffort | null>(() => savedEffort(effortKey));
  const setEffort = useCallback(
    (value: ReasoningEffort | null) => {
      setEffortState(value);
      saveEffort(effortKey, value);
    },
    [effortKey],
  );
  const [effortOpen, setEffortOpen] = useState(false);
  const work = active ?? latestRun;
  const efforts = useEffortLevels(
    session.request.projectId,
    work?.agent ?? session.request.agent,
    work?.model ?? session.request.model ?? undefined,
  );
  const customAgents = useAgentConfigStore((state) => state.customAgents);
  const skills = useProviderSkills(
    agentAdapter(work?.agent ?? session.request.agent, customAgents),
    session.request.projectId,
  );
  const [side, setSide] = useState<{ id: string; text: string } | null>(null);
  const history = useMemo(
    () =>
      session.messages
        .filter((message) => !message.origin && !message.canceled)
        .map((message) => message.text),
    [session.messages],
  );
  const commands = useMemo(
    () => ({
      effort: efforts.levels.length > 0,
      // A detached conversation window has no new-work composer to open.
      clear: windowKind().kind !== 'liveSession',
      btw: !!work,
      provider: skills,
    }),
    [efforts.levels.length, work, skills],
  );
  const assist = useComposerAssist({
    input,
    text,
    setText: (value) => {
      editing.current = true;
      setText(value);
    },
    projectPath: session.request.projectPath,
    history,
    commands,
    disabled: session.closed,
    run: (command: ComposerCommand, argument: string) => {
      if (command.id === 'effort') setEffortOpen(true);
      else if (command.id === 'clear') emitAppEvent('new-work', session.request.projectId);
      else if (command.id === 'btw') setSide({ id: crypto.randomUUID(), text: argument });
    },
  });
  useEffect(() => {
    if (!addition || added.current === addition.revision) return;
    added.current = addition.revision;
    let value: string;
    try {
      value = appendFeedbackDraft(latest.current, addition.text);
      localStorage.setItem(key, value);
    } catch (cause) {
      const message =
        cause instanceof Error && cause.name === 'Error'
          ? cause.message
          : 'The draft could not be saved. Your feedback is still available; free browser storage and try again.';
      setError(message);
      addition.applied(message);
      return;
    }
    editing.current = true;
    setError('');
    latest.current = value;
    setText(value);
    input.current?.focus();
    addition.applied();
  }, [addition, key]);
  useEffect(() => {
    if (!editing.current && !saving && session.draft.revision > revision.current) {
      revision.current = session.draft.revision;
      saved.current = session.draft.text;
      setText(session.draft.text);
    }
  }, [session.draft, saving]);
  useEffect(() => {
    try {
      if (text) localStorage.setItem(key, text);
      else localStorage.removeItem(key);
    } catch {
      setError('The local draft could not be saved. Keep this window open until sending succeeds.');
    }
    if (text === saved.current || saving) return;
    const timer = setTimeout(() => {
      const value = text;
      const previous = draftSave.current ?? Promise.resolve();
      const operation = previous
        .then(() =>
          sessionCommand<SessionDraft>('draft', {
            id: session.id,
            text: value,
            revision: revision.current,
          }),
        )
        .then((draft) => {
          revision.current = draft.revision;
          saved.current = draft.text;
          if (latest.current === value) editing.current = false;
        })
        .catch((cause) => setError(describeError(cause)));
      draftSave.current = operation;
    }, 450);
    return () => clearTimeout(timer);
  }, [key, session.id, text, saving]);
  // Conversations reopen paused after a restart. With nothing running, nothing to review
  // and no bot reply limit reached, sending is a clear intent to continue, so it resumes.
  const resumesOnSend =
    session.paused &&
    !active &&
    !session.error &&
    !session.persona &&
    (session.batches.at(-1)?.settled ?? true);
  const settle = (draft: SessionDraft, value: string) => {
    pending.current = null;
    assist.sent();
    if (!draft.text || latest.current.trim() === value) {
      revision.current = draft.revision;
      saved.current = draft.text;
    }
    if (latest.current.trim() === value) {
      setText(draft.text);
      editing.current = false;
      localStorage.removeItem(key);
    }
  };
  const send = async (mode: 'queue' | 'interrupt' | 'preview' = 'queue') => {
    const value = text.trim();
    if (!value || sending.current || session.closed) return;
    if (assist.intercept(value)) return;
    if (!pending.current || pending.current.text !== value)
      pending.current = { id: crypto.randomUUID(), text: value };
    const message = pending.current;
    sending.current = true;
    setSaving(true);
    setError('');
    try {
      await draftSave.current;
      // A turn that takes messages gets this one now; otherwise it is stopped and sent next.
      if (mode === 'interrupt' && active?.steerable) {
        const steered = await sessionCommand<SessionDraft | null>('steer', {
          id: session.id,
          messageId: message.id,
          text: value,
          draftRevision: revision.current,
        });
        if (steered) {
          settle(steered, value);
          await onSent();
          input.current?.focus();
          return;
        }
      }
      if (mode !== 'queue') {
        await sessionCommand('action', { id: session.id, action: 'pause' });
        if (mode === 'preview' && latestRun) await stopPreview(latestRun.id);
        if (mode === 'interrupt' && active)
          await stopAndSettle(
            active.id,
            async () => {
              await onSent();
              return useLiveSessionStore.getState().runs.find((run) => run.id === active.id);
            },
            {
              saved: 'message',
              settled: (run) =>
                !!useLiveSessionStore
                  .getState()
                  .sessions.find((item) => item.id === session.id)
                  ?.batches.find((batch) => batch.runId === run.id)?.settled,
            },
          );
      }
      const draft = await sessionCommand<SessionDraft>('send', {
        id: session.id,
        messageId: message.id,
        text: value,
        draftRevision: revision.current,
        reasoningEffort: effort,
      });
      settle(draft, value);
      await onSent();
      if (mode !== 'queue' || resumesOnSend) {
        await sessionCommand('action', { id: session.id, action: 'resume' });
        await onSent();
      }
      input.current?.focus();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };
  useComposerKeybindings(form, {
    focus: () => input.current?.focus(),
    send: () => void send(),
    effortPicker: () => {
      if (saving || session.closed || !efforts.levels.length) return false;
      setEffortOpen(!effortOpen);
      if (effortOpen) input.current?.focus();
    },
  });
  return (
    <form
      ref={form}
      data-composer
      className="live-composer"
      data-dragging={attachments.dragging || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <BorderBeamLayer
        variant={recording ? 'pulse' : 'travel'}
        active={recording || (!!active && isRunning(active))}
        level={recording ? 'var(--voice-level, 0)' : undefined}
        strength={recording ? 1 : 0.85}
      />
      {assist.menu}
      {side && work && (
        <SideQuestion
          run={work}
          question={side}
          onClose={() => {
            setSide(null);
            input.current?.focus();
          }}
          onInsert={(answer) => {
            edit((current) => (current.trim() ? `${current.trimEnd()}\n\n${answer}` : answer));
            setSide(null);
          }}
        />
      )}
      <Textarea
        ref={input}
        {...assist.fieldProps}
        aria-label="Message"
        placeholder="Message, / for commands, @ for files…"
        rows={2}
        maxLength={12000}
        value={text}
        disabled={session.closed}
        onChange={(event) => {
          editing.current = true;
          setText(event.target.value);
        }}
        onPaste={attachments.onPaste}
        onKeyDown={(event) => {
          if (assist.onKeyDown(event)) return;
          if (event.key === 'Enter' && !event.shiftKey && !composingKey(event.nativeEvent)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <PastedTextChips
        pasted={attachments.pasted}
        onUndo={attachments.undoPaste}
        onDismiss={attachments.dismissPaste}
      />
      {error && (
        <InlineNotice tone="error">
          {error}
          {session.draft.revision > revision.current && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                revision.current = session.draft.revision;
                saved.current = session.draft.text;
                editing.current = false;
                setText(session.draft.text);
                setError('');
              }}
            >
              Use saved draft
            </Button>
          )}
        </InlineNotice>
      )}
      {attachments.error && (
        <InlineNotice tone="error" action={<DismissButton onDismiss={attachments.clearError} />}>
          {attachments.error}
        </InlineNotice>
      )}
      <div className="live-composer-actions">
        <VoiceButton
          disabled={saving || session.closed}
          onRecordingChange={setRecording}
          onText={(value) => {
            editing.current = true;
            const next = insertDictation(text, value, input.current);
            setText(next.text);
            placeCaret(input.current, next.caret);
          }}
        />
        {attachments.available && (
          <AttachButton
            onPick={() => void attachments.pick()}
            busy={attachments.busy}
            disabled={saving}
          />
        )}
        <ContextMeter run={work} />
        <ComposerEffortPicker
          levels={efforts.levels}
          loaded={efforts.loaded}
          value={effort}
          onChange={setEffort}
          open={effortOpen}
          onOpenChange={(open) => {
            setEffortOpen(open);
            if (!open) input.current?.focus();
          }}
          disabled={saving || session.closed}
        />
        {active && (
          <Button
            type="button"
            variant="outline"
            disabled={!text.trim() || saving || session.closed || active.status === 'stopping'}
            onClick={() => void send('interrupt')}
          >
            {active.steerable ? 'Send now' : 'Stop and send'}
          </Button>
        )}
        {previewRunning && latestRun && (
          <Button
            type="button"
            variant="outline"
            disabled={!text.trim() || saving || session.closed}
            onClick={() => void send('preview')}
          >
            Stop preview and send
          </Button>
        )}
        <Button
          type="submit"
          disabled={!text.trim() || saving || session.closed}
          loading={saving}
          loadingLabel="Sending…"
        >
          {active || (session.paused && !resumesOnSend) ? 'Queue message' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
