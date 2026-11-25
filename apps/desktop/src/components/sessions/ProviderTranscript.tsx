import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Button, Disclosure, DisclosureSummary, InlineNotice, Textarea } from '@jackalope/ui';
import { Paperclip, Wrench } from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { useAction } from '../../hooks/useAction';
import type { TranscriptEntry } from '../../lib/external-sessions';
import { openExternalUrl } from '../../lib/native/env';
import { ActionError } from '../ui/ActionError';
import { TranscriptResult } from './TranscriptResult';
import './live-session.css';

/** A recorded time, or null when it is missing or unreadable. */
export function when(at?: string | null) {
  if (!at) return null;
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ToolCalls({ tools }: { tools: NonNullable<TranscriptEntry['tools']> }) {
  const names = [...new Set(tools.map((tool) => tool.name))].join(', ');
  if (!tools.some((tool) => tool.summary))
    return (
      <p className="external-tools">
        <Wrench size={12} aria-hidden="true" />
        <span>Used {names}</span>
      </p>
    );
  return (
    <Disclosure className="external-tools external-tool-calls">
      <DisclosureSummary>
        <Wrench size={12} aria-hidden="true" />
        <span>Used {names}</span>
      </DisclosureSummary>
      <ol>
        {tools.map((tool, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: calls are a fixed, ordered read
          <li key={index}>
            <strong>{tool.name}</strong>
            {tool.summary && <code>{tool.summary}</code>}
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}

/**
 * A Claude Code or Codex transcript, read-only: the person's messages on the right and the
 * agent's replies beside its character, with tool calls summarized between them.
 */
export function ProviderTranscript({
  agent,
  agentName,
  entries,
  earlier,
  notes,
}: {
  agent: string;
  agentName: string;
  entries: TranscriptEntry[];
  /** Entries before the first one shown, left out because the transcript is long. */
  earlier: number;
  /** Quiet lines after the transcript, such as what was not shown. */
  notes?: string[];
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (entries.length) end.current?.scrollIntoView({ block: 'end' });
  }, [entries]);
  return (
    <section className="external-transcript" aria-label="Conversation">
      {earlier > 0 && (
        <p className="live-muted">{earlier.toLocaleString()} earlier messages are not shown.</p>
      )}
      {entries.map((entry, index) =>
        entry.role === 'user' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are a fixed, ordered read
          <article key={index} className="live-message live-sent">
            <span className="live-author sr-only">You</span>
            {entry.text && <p>{entry.text}</p>}
            {!!entry.attachments?.length && (
              <ul className="external-attachments" aria-label="Attachments">
                {entry.attachments.map((attachment) => (
                  <li key={attachment}>
                    <Paperclip size={12} aria-hidden="true" />
                    <span>{attachment}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ) : entry.role === 'assistant' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are a fixed, ordered read
          <article key={index} className="live-message live-reply">
            <span className="live-mascot">
              <AgentCharacter provider={agent} />
            </span>
            <div>
              <span className="live-author">{agentName}</span>
              <TranscriptResult
                content={entry.text}
                active={false}
                recent={index >= entries.length - 6}
                onOpenLink={(url) => void openExternalUrl(url)}
              />
            </div>
          </article>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are a fixed, ordered read
          <ToolCalls key={index} tools={entry.tools ?? []} />
        ),
      )}
      {!entries.length && (
        <p className="live-muted">This conversation has no messages to show yet.</p>
      )}
      {notes?.map((note) => (
        <p key={note} className="live-muted">
          {note}
        </p>
      ))}
      <div ref={end} />
    </section>
  );
}

/**
 * The card under a read-only transcript that continues it in Jackalope, or says why it
 * cannot be continued.
 */
export function ContinueComposer({
  agentName,
  cwd,
  unavailable,
  inputRef,
  onContinue,
}: {
  agentName: string;
  cwd: string;
  unavailable?: string | null;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onContinue: (text: string) => Promise<void>;
}) {
  const send = useAction();
  const [text, setText] = useState('');
  const fallback = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? fallback;
  const submit = () => {
    if (text.trim()) void send.run(() => onContinue(text.trim()));
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer convenience; the field and buttons stay reachable by keyboard
    <form
      className="external-continue"
      onClick={(event) => {
        // The whole card reads as the field, so a click on its padding focuses it.
        if (event.target === event.currentTarget) input.current?.focus();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {unavailable ? (
        <InlineNotice tone="warning">{unavailable}</InlineNotice>
      ) : (
        <>
          <Textarea
            ref={input}
            aria-label={`Continue this ${agentName} conversation`}
            placeholder={`Continue in Jackalope. ${agentName} works directly in ${cwd}.`}
            value={text}
            rows={2}
            maxLength={12_000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="external-continue-actions">
            <ActionError error={send.error} />
            <Button
              type="submit"
              disabled={!text.trim()}
              loading={send.busy}
              loadingLabel="Continuing…"
            >
              Continue
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
