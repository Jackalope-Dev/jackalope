import { describeError } from '@jackalope/contracts/errors';
import { Button, CopyButton, InlineNotice, LoadingState } from '@jackalope/ui';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { answersSideQuestions, catalogEntry } from '../../lib/agent-catalog';
import { openInBrowser } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import type { TaskRun } from '../../lib/run-types';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { DismissButton } from '../ui/DismissButton';
import './composer.css';

const TaskMarkdown = lazy(() => import('../tasks/TaskMarkdown'));

interface SideAnswer {
  text: string;
  model: string | null;
}

/**
 * A `/btw` question about the work in `run`, answered by a read-only fork of its agent
 * session. Nothing here joins the task's transcript or queue, and the running work is
 * not interrupted. The answer can be copied or added to the draft.
 */
export function SideQuestion({
  run,
  question,
  onClose,
  onInsert,
}: {
  run: TaskRun;
  question: { id: string; text: string };
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const customAgents = useAgentConfigStore((state) => state.customAgents);
  const supported = answersSideQuestions(run.agent, customAgents);
  const [answer, setAnswer] = useState<SideAnswer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operation = useRef('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: asking the same text again is a new question
  useEffect(() => {
    if (!supported) return;
    const id = crypto.randomUUID();
    operation.current = id;
    let settled = false;
    setAnswer(null);
    setError('');
    setBusy(true);
    invokeNative<SideAnswer>('task_side_question', {
      runId: run.id,
      question: question.text,
      operationId: id,
    })
      .then((value) => {
        if (operation.current === id) setAnswer(value);
      })
      .catch((cause) => {
        if (operation.current === id) setError(describeError(cause));
      })
      .finally(() => {
        settled = true;
        if (operation.current === id) setBusy(false);
      });
    return () => {
      operation.current = '';
      // Closing or re-asking stops a fork still running; an answered one has already ended.
      if (!settled)
        void invokeNative('task_side_question_cancel', { operationId: id }).catch(() => undefined);
    };
  }, [supported, run.id, question.id, question.text]);
  const agentName = catalogEntry(run.agent)?.name ?? run.agent;
  return (
    <section className="side-question" aria-label="Side question" aria-busy={busy || undefined}>
      <div className="side-question-header">
        <span className="side-question-label">Side question</span>
        <strong title={question.text}>{question.text}</strong>
        <DismissButton label="Close side question" onDismiss={onClose} />
      </div>
      {!supported ? (
        <InlineNotice>
          {agentName} can't answer side questions. Jackalope can fork only Claude Code and Codex
          sessions read-only, so nothing was asked.
        </InlineNotice>
      ) : busy ? (
        <LoadingState compact label={`Asking a read-only copy of ${agentName}…`} />
      ) : error ? (
        <InlineNotice tone="error">{error}</InlineNotice>
      ) : answer ? (
        <div className="side-question-answer">
          <Suspense fallback={<p>{answer.text}</p>}>
            <TaskMarkdown
              content={answer.text}
              active={false}
              onOpenLink={(url) => void openInBrowser(url).catch(() => undefined)}
            />
          </Suspense>
        </div>
      ) : null}
      <div className="side-question-actions">
        {busy && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void invokeNative('task_side_question_cancel', {
                operationId: operation.current,
              }).catch(() => undefined);
            }}
          >
            Stop
          </Button>
        )}
        {answer && (
          <>
            <CopyButton text={answer.text} label="Copy answer" variant="outline" size="sm" />
            <Button type="button" variant="outline" size="sm" onClick={() => onInsert(answer.text)}>
              Add to draft
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
