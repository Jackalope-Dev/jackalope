import { Button, LoadingState } from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import { useAction } from '../../hooks/useAction';
import {
  continueExternalSession,
  type ExternalSession,
  type ExternalTranscript,
  externalSessionTranscript,
} from '../../lib/external-sessions';
import { openConversation } from '../../lib/work-selection';
import { useExternalSessionStore } from '../../stores/externalSessionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { ProviderMark } from '../agents/ProviderMark';
import { ActionError } from '../ui/ActionError';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { ContinueComposer, ProviderTranscript, when } from './ProviderTranscript';
import './live-session.css';

/**
 * A conversation someone had with Claude Code or Codex outside Jackalope, read from that
 * CLI's own store. It is read-only here; continuing it starts a Jackalope conversation that
 * resumes the CLI's session in the folder it ran in.
 */
export function ExternalSessionView({ session }: { session: ExternalSession }) {
  const [transcript, setTranscript] = useState<ExternalTranscript | null>(null);
  const load = useAction();
  const input = useRef<HTMLTextAreaElement>(null);
  const loadRun = useRef(load.run);
  loadRun.current = load.run;
  // Reload when the CLI writes to the conversation, which changes its last activity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt marks new messages
  useEffect(() => {
    void loadRun.current(async () => setTranscript(await externalSessionTranscript(session.key)));
  }, [session.key, session.updatedAt]);
  const updated = when(session.updatedAt);
  const continueHere = async (text: string) => {
    const id = await continueExternalSession(session.key, text);
    await useLiveSessionStore.getState().refresh(id);
    void useExternalSessionStore.getState().refresh();
    openConversation(id);
  };
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
        <ProviderTranscript
          agent={session.agent}
          agentName={session.agentName}
          entries={transcript.entries}
          earlier={transcript.earlier}
          notes={transcript.subagentLines > 0 ? ['Subagent work is not shown.'] : undefined}
        />
      )}
      <ContinueComposer
        agentName={session.agentName}
        cwd={session.cwd}
        unavailable={session.unavailable}
        inputRef={input}
        onContinue={continueHere}
      />
    </WorkspacePage>
  );
}
