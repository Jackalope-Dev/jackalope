import { Textarea } from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import { type LiveSession, type SessionDraft, sessionCommand } from '../../lib/live-session';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function SessionComposer({
  session,
  onSent,
}: {
  session: LiveSession;
  onSent: () => Promise<void>;
}) {
  const key = `jackalope-live-draft:${location.search.includes('liveSession=') ? 'window' : 'main'}:${session.id}`;
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
  const send = async () => {
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
        <span className="live-muted">{session.request.projectName}</span>
        <Button
          type="submit"
          disabled={!text.trim() || saving || session.closed}
          loading={saving}
          loadingLabel="Sending…"
        >
          Send
        </Button>
      </div>
    </form>
  );
}
