import { Button, InlineNotice, LoadingState } from '@jackalope/ui';
import { useEffect, useRef, useState } from 'react';
import { useAction } from '../../hooks/useAction';
import { PROTECTED_FOLDER_NOTE } from '../../lib/external-sessions';
import {
  continueImportedConversation,
  type ImportedConversation,
  type ImportedTranscript,
  importedConversationTranscript,
  scanSessionsToImport,
  startSessionImport,
} from '../../lib/imported-conversations';
import { openConversation } from '../../lib/work-selection';
import { useImportedConversationStore } from '../../stores/importedConversationStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { ProviderMark } from '../agents/ProviderMark';
import { ActionError } from '../ui/ActionError';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { ContinueComposer, ProviderTranscript, when } from './ProviderTranscript';
import './live-session.css';

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/**
 * A Claude Code or Codex conversation imported into Jackalope. Its transcript is
 * Jackalope's own copy and is read-only; continuing it starts a Jackalope conversation that
 * resumes the CLI's session in the folder it ran in.
 */
export function ImportedConversationView({ conversation }: { conversation: ImportedConversation }) {
  const [transcript, setTranscript] = useState<ImportedTranscript | null>(null);
  const load = useAction();
  const update = useAction();
  const input = useRef<HTMLTextAreaElement>(null);
  const loadRun = useRef(load.run);
  loadRun.current = load.run;
  const importing = useImportedConversationStore((state) => !!state.progress?.running);
  // Reload when an import replaces the saved copy.
  // biome-ignore lint/correctness/useExhaustiveDependencies: importedAt marks a new copy
  useEffect(() => {
    void loadRun.current(async () =>
      setTranscript(await importedConversationTranscript(conversation.id)),
    );
  }, [conversation.id, conversation.importedAt]);
  const last = when(conversation.lastAt);
  const continued = conversation.continuedIn;
  const continueHere = async (text: string) => {
    const id = await continueImportedConversation(conversation.id, text);
    await useLiveSessionStore.getState().refresh(id);
    void useImportedConversationStore.getState().refresh();
    openConversation(id);
  };
  const updateCopy = () =>
    update.run(async () => {
      await scanSessionsToImport();
      await startSessionImport([conversation.id]);
      await useImportedConversationStore.getState().refresh();
    });
  const notes = [
    conversation.skippedLines > 0 &&
      `${plural(conversation.skippedLines, 'line', 'lines')} of the original could not be read.`,
    conversation.subagentLines > 0 && 'Subagent work is not shown.',
  ].filter((note): note is string => !!note);
  return (
    <ProviderTranscript
      agent={conversation.agent}
      agentName={conversation.agentName}
      entries={transcript?.entries ?? []}
      loaded={!!transcript}
      earlier={conversation.earlier}
      notes={notes}
      before={
        <>
          <WorkspaceHeading
            title={conversation.title}
            description={
              <span className="external-session-meta">
                <ProviderMark provider={conversation.agent} size={14} />
                <span>Imported from {conversation.agentName}</span>
                {conversation.branch && <span>· {conversation.branch}</span>}
                {last && conversation.lastAt && (
                  <time dateTime={conversation.lastAt} title={last.toLocaleString()}>
                    · {last.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </time>
                )}
                <span className="external-session-path" title={conversation.cwd}>
                  · {conversation.cwd}
                </span>
                {conversation.protectedFolder && <span>· {PROTECTED_FOLDER_NOTE}</span>}
              </span>
            }
            action={
              continued ? (
                <Button onClick={() => openConversation(continued)}>Open conversation</Button>
              ) : conversation.unavailable ? undefined : (
                <Button onClick={() => input.current?.focus()}>Continue in Jackalope</Button>
              )
            }
          />
          {conversation.changed && (
            <InlineNotice
              className="external-session-notice"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={importing}
                  loading={update.busy}
                  loadingLabel="Updating…"
                  onClick={() => void updateCopy()}
                >
                  Update
                </Button>
              }
            >
              {conversation.agentName} wrote to this conversation after it was imported.
            </InlineNotice>
          )}
          <ActionError error={load.error || update.error} />
          {load.busy && !transcript && <LoadingState label="Reading the conversation…" />}
        </>
      }
      footer={
        continued ? (
          <div className="external-continue">
            <InlineNotice>
              This conversation continues in Jackalope. Its later messages are there.
            </InlineNotice>
          </div>
        ) : (
          <ContinueComposer
            agentName={conversation.agentName}
            cwd={conversation.cwd}
            unavailable={conversation.unavailable}
            inputRef={input}
            onContinue={continueHere}
          />
        )
      }
    />
  );
}
