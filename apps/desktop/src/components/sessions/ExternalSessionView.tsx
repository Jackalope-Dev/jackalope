import { AgentCharacter } from '@jackalope/brand/agent-character';
import { Button, InlineNotice, LoadingState, Textarea } from '@jackalope/ui';
import { Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAction } from '../../hooks/useAction';
import {
  continueExternalSession,
  type ExternalSession,
  type ExternalTranscript,
  externalSessionTranscript,
} from '../../lib/external-sessions';
import { openExternalUrl } from '../../lib/native/env';
import { openConversation } from '../../lib/work-selection';
import { useExternalSessionStore } from '../../stores/externalSessionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { ProviderMark } from '../agents/ProviderMark';
import { ActionError } from '../ui/ActionError';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { TranscriptResult } from './TranscriptResult';
import './live-session.css';

function when(at?: string | null) {
  if (!at) return null;
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A conversation someone had with Claude Code or Codex outside Jackalope, read from that
 * CLI's own store. It is read-only here; continuing it starts a Jackalope conversation that
 * resumes the CLI's session in the folder it ran in.
 */
export function ExternalSessionView({ session }: { session: ExternalSession }) {
  const [transcript, setTranscript] = useState<ExternalTranscript | null>(null);
  const load = useAction();
  const send = useAction();
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const loadRun = useRef(load.run);
  loadRun.current = load.run;
  // Reload when the CLI writes to the conversation, which changes its last activity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt marks new messages
  useEffect(() => {
    void loadRun.current(async () => setTranscript(await externalSessionTranscript(session.key)));
  }, [session.key, session.updatedAt]);
  useEffect(() => {
    if (transcript) end.current?.scrollIntoView({ block: 'end' });
  }, [transcript]);
  const updated = when(session.updatedAt);
  const continueHere = () =>
    send.run(async () => {
      const id = await continueExternalSession(session.key, text.trim());
      await useLiveSessionStore.getState().refresh(id);
      void useExternalSessionStore.getState().refresh();
      openConversation(id);
    });
  const reply = (entry: ExternalTranscript['entries'][number], index: number) => (
    <article key={index} className="live-message live-reply">
      <span className="live-mascot">
        <AgentCharacter provider={session.agent} />
      </span>
      <div>
        <span className="live-author">{session.agentName}</span>
        <TranscriptResult
          content={entry.text}
          active={false}
          recent={index >= (transcript?.entries.length ?? 0) - 6}
          onOpenLink={(url) => void openExternalUrl(url)}
        />
      </div>
    </article>
  );
  return (
    <WorkspacePage className="external-session" aria-label={session.title}>
      <WorkspaceHeading
        title={session.title}
        description={
          <span className="external-session-meta">
            <ProviderMark provider={session.agent} size={14} />
            <span>{session.agentName} outside Jackalope</span>
            {session.branch && <span>· {session.branch}</span>}
            {updated && (
              <time dateTime={session.updatedAt} title={updated.toLocaleString()}>
                · {updated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
            )}
            <span className="external-session-path" title={session.cwd}>
              · {session.cwd}
            </span>
          </span>
        }
        action={
          session.unavailable ? undefined : (
            <Button onClick={() => input.current?.focus()}>Continue in Jackalope</Button>
          )
        }
      />
      <ActionError error={load.error} />
      {load.busy && !transcript && <LoadingState label="Reading the conversation…" />}
      {transcript && (
        <section className="external-transcript" aria-label="Conversation">
          {transcript.earlier > 0 && (
            <p className="live-muted">
              {transcript.earlier.toLocaleString()} earlier messages are not shown.
            </p>
          )}
          {transcript.entries.map((entry, index) =>
            entry.role === 'user' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: entries are a fixed, ordered read
              <article key={index} className="live-message live-sent">
                <span className="live-author sr-only">You</span>
                <p>{entry.text}</p>
              </article>
            ) : entry.role === 'assistant' ? (
              reply(entry, index)
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: entries are a fixed, ordered read
              <p key={index} className="external-tools">
                <Wrench size={12} aria-hidden="true" />
                <span>Used {[...new Set(entry.tools ?? [])].join(', ')}</span>
              </p>
            ),
          )}
          {!transcript.entries.length && (
            <p className="live-muted">This conversation has no messages to show yet.</p>
          )}
          {transcript.subagentLines > 0 && (
            <p className="live-muted">Subagent work is not shown.</p>
          )}
          <div ref={end} />
        </section>
      )}
      <form
        className="external-continue"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void continueHere();
        }}
      >
        {session.unavailable ? (
          <InlineNotice tone="warning">{session.unavailable}</InlineNotice>
        ) : (
          <>
            <Textarea
              ref={input}
              aria-label={`Continue this ${session.agentName} conversation`}
              placeholder={`Continue in Jackalope. ${session.agentName} works directly in ${session.cwd}.`}
              value={text}
              rows={2}
              maxLength={12_000}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && text.trim()) {
                  event.preventDefault();
                  void continueHere();
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
    </WorkspacePage>
  );
}
