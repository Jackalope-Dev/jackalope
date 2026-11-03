import { FormField, Input, Textarea } from '@jackalope/ui';
import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../ui/button';
import './drafted-message.css';

interface Message {
  title: string;
  body: string;
}

/** Commit failures arrive as structured objects; everything else as text. */
export function errorMessage(cause: unknown) {
  if (cause && typeof cause === 'object' && 'message' in cause)
    return String((cause as { message: unknown }).message);
  return String(cause);
}

/**
 * A title and description an agent drafts from the changes. Opening drafts into empty
 * fields and keeps anything typed meanwhile; Write with AI replaces both on request.
 */
export function useDraftedMessage(generate: () => Promise<Message>) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(0);
  const write = (replace: boolean) => {
    const current = ++attempt.current;
    setError('');
    setDrafting(true);
    generate()
      .then((text) => {
        if (current !== attempt.current) return;
        setTitle((typed) => (replace ? text.title : typed || text.title));
        setBody((typed) => (replace ? text.body : typed || text.body));
      })
      .catch((cause) => {
        if (current === attempt.current) setError(errorMessage(cause));
      })
      .finally(() => {
        if (current === attempt.current) setDrafting(false);
      });
  };
  const reset = () => {
    attempt.current += 1;
    setTitle('');
    setBody('');
    setError('');
    setDrafting(false);
  };
  return { title, setTitle, body, setBody, drafting, error, write, reset };
}

export function DraftedMessageFields({
  message,
  busy,
  rows = 6,
}: {
  message: ReturnType<typeof useDraftedMessage>;
  busy: boolean;
  rows?: number;
}) {
  return (
    <>
      <div className="drafted-message-title">
        <FormField
          label="Title"
          description={
            message.drafting
              ? 'Drafting from the changes…'
              : message.error
                ? `Could not draft from the changes: ${message.error}`
                : undefined
          }
        >
          <Input
            value={message.title}
            placeholder={message.drafting ? 'Drafting…' : undefined}
            disabled={busy}
            onChange={(event) => message.setTitle(event.target.value)}
          />
        </FormField>
        <Button
          variant="ghost"
          size="sm"
          className="drafted-message-write"
          disabled={busy || message.drafting}
          loading={message.drafting}
          loadingLabel="Writing…"
          onClick={() => message.write(true)}
        >
          <Sparkles size={16} aria-hidden="true" /> Write with AI
        </Button>
      </div>
      <FormField label="Description">
        <Textarea
          rows={rows}
          value={message.body}
          disabled={busy}
          onChange={(event) => message.setBody(event.target.value)}
        />
      </FormField>
    </>
  );
}
