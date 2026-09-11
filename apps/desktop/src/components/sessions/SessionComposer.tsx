import { Textarea } from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import { type LiveSession, type SessionDraft, sessionCommand } from '../../lib/live-session';
import { isActive, nativeTask, type TaskRun } from '../../lib/task-runtime';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedPreview } from '../tasks/useManagedPreview';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

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
  const key = `jackalope-live-draft:${location.search.includes('liveSession=') ? 'window' : 'main'}:${session.id}`;
  const previewRunning = useManagedPreview(latestRun?.id, !active);
  const [text, setText] = useState(() => localStorage.getItem(key) ?? session.draft.text);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
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
  useEffect(() => {
    if (!addition || added.current === addition.revision) return;
    added.current = addition.revision;
    const value = [latest.current, addition.text].filter(Boolean).join('\n\n');
    if (value.length > 12000) {
      const message =
        'This would exceed the message limit. Send or shorten the existing draft first.';
      setError(message);
      addition.applied(message);
      return;
    }
    editing.current = true;
    latest.current = value;
    setText(value);
    input.current?.focus();
    addition.applied();
  }, [addition]);
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
        .catch((cause) => setError(String(cause)));
      draftSave.current = operation;
    }, 450);
    return () => clearTimeout(timer);
  }, [key, session.id, text, saving]);
  const send = async (mode: 'queue' | 'interrupt' | 'preview' = 'queue') => {
    const value = text.trim();
    if (!value || sending.current || session.closed) return;
    if (!pending.current || pending.current.text !== value)
      pending.current = { id: crypto.randomUUID(), text: value };
    const message = pending.current;
    sending.current = true;
    setSaving(true);
    setError('');
    try {
      await draftSave.current;
      if (mode !== 'queue') {
        await sessionCommand('action', { id: session.id, action: 'pause' });
        if (mode === 'preview' && latestRun)
          await nativeTask('task_preview_stop', { id: latestRun.id });
        if (mode === 'interrupt' && active) {
          await nativeTask('task_stop', { id: active.id });
          let stopped = false;
          for (let attempt = 0; attempt < 120; attempt++) {
            await onSent();
            const state = useLiveSessionStore.getState();
            const run = state.runs.find((run) => run.id === active.id);
            if (!run || run.status === 'interrupted')
              throw new Error(
                'Inspect interrupted work before continuing. Your message is still saved.',
              );
            if (
              !isActive(run) &&
              state.sessions
                .find((item) => item.id === session.id)
                ?.batches.find((batch) => batch.runId === run.id)?.settled
            ) {
              stopped = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (!stopped)
            throw new Error(
              'Work is still stopping. Your message is saved; send it after the attempt stops.',
            );
        }
      }
      const draft = await sessionCommand<SessionDraft>('send', {
        id: session.id,
        messageId: message.id,
        text: value,
        draftRevision: revision.current,
      });
      pending.current = null;
      if (!draft.text || latest.current.trim() === value) {
        revision.current = draft.revision;
        saved.current = draft.text;
      }
      if (latest.current.trim() === value) {
        setText(draft.text);
        editing.current = false;
        localStorage.removeItem(key);
      }
      await onSent();
      if (mode !== 'queue') {
        await sessionCommand('action', { id: session.id, action: 'resume' });
        await onSent();
      }
      input.current?.focus();
    } catch (cause) {
      setError(String(cause));
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };
  return (
    <form
      className="live-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Textarea
        ref={input}
        aria-label="Message"
        placeholder="Message…"
        rows={2}
        maxLength={12000}
        value={text}
        disabled={session.closed}
        onChange={(event) => {
          editing.current = true;
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
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
      <div className="live-composer-actions">
        <p className="live-muted">
          {active
            ? 'Queue messages for the next batch, or stop current work and send now.'
            : session.paused
              ? 'Queue is paused. Sending saves the message; Resume queue starts it.'
              : 'Messages continue in the same workspace and account.'}
        </p>
        {active && (
          <Button
            type="button"
            variant="outline"
            disabled={!text.trim() || saving || session.closed || active.status === 'stopping'}
            onClick={() => void send('interrupt')}
          >
            Stop and send
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
          {active || session.paused ? 'Queue message' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
