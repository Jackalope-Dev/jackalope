import { Textarea } from '@jackalope/ui';
import { Check, MessageCircle, Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { PendingUserPrompt } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import './task-experience.css';

export function AgentQuestion({
  prompt,
  active,
  agentName,
  agentDetail,
  onAnswer,
  onContinue,
}: {
  prompt: PendingUserPrompt;
  active: boolean;
  agentName?: string;
  agentDetail?: string;
  onAnswer: (answer: string) => Promise<void>;
  /** Answers after the attempt ended, by continuing the task with the answer. */
  onContinue?: (answer: string) => Promise<void>;
}) {
  const id = useId();
  const multiple = prompt.inputType === 'multiChoice';
  const [selected, setSelected] = useState<string[]>([]);
  const options =
    prompt.inputType === 'confirmation'
      ? ['Yes, proceed', 'No, adjust']
      : [...new Set(prompt.options)];
  const [answer, setAnswer] = useState(prompt.defaultValue ?? '');
  const [custom, setCustom] = useState(
    () =>
      !!prompt.defaultValue &&
      prompt.inputType !== 'text' &&
      !options.includes(prompt.defaultValue),
  );
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const answerRef = useRef<HTMLParagraphElement>(null);
  const answered = prompt.status === 'answered' || sent !== null;
  const continuing = !active && !!onContinue;
  useEffect(() => {
    if (sent !== null) answerRef.current?.focus();
  }, [sent]);
  const freeform = !multiple && (prompt.inputType === 'text' || options.length === 0 || custom);
  const response = multiple ? JSON.stringify(selected) : answer.trim();
  const hasResponse = multiple ? selected.length > 0 : !!answer.trim();
  /** Selects `option`, or toggles it when several may be chosen. */
  const choose = (option: string) => {
    if (multiple) {
      setSelected((current) =>
        options.filter((value) =>
          value === option ? !current.includes(value) : current.includes(value),
        ),
      );
      return;
    }
    setCustom(false);
    setAnswer(option);
  };
  const submit = async () => {
    if ((!active && !onContinue) || answered || inFlight.current || !hasResponse) return;
    inFlight.current = true;
    setSending(true);
    setError('');
    try {
      if (active) await onAnswer(response);
      else await onContinue?.(displayAnswer(response, multiple) ?? response);
      setSent(response);
    } catch (error) {
      setError(String(error));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  return (
    <section
      className="agent-question"
      data-answered={answered || undefined}
      aria-labelledby={`${id}-question`}
    >
      <div className="task-experience-heading">
        <span className="task-experience-icon">
          <MessageCircle size={18} aria-hidden="true" />
        </span>
        <span>
          {answered
            ? 'Your response'
            : active
              ? `${agentName ?? 'The agent'} needs your input`
              : continuing
                ? 'Answer to continue'
                : 'Unanswered question'}
        </span>
        <span className="task-experience-meta">
          {answered ? 'Answered' : active ? 'Awaiting response' : 'Task ended'}
        </span>
      </div>
      {agentDetail && <p className="agent-question-identity">{agentDetail}</p>}
      {prompt.header && <p className="agent-question-header">{prompt.header}</p>}
      <h3 id={`${id}-question`} className="agent-question-title">
        {prompt.question}
      </h3>
      {prompt.rationale && !answered && <p className="task-experience-muted">{prompt.rationale}</p>}
      {prompt.whyAsk && !answered && (
        <p className="task-experience-muted">Why ask: {prompt.whyAsk}</p>
      )}
      {answered ? (
        <p ref={answerRef} tabIndex={-1} className="agent-question-answer" role="status">
          <Check size={18} aria-hidden="true" />
          <span>{displayAnswer(prompt.answer ?? sent, multiple)}</span>
        </p>
      ) : !active && !continuing ? (
        <p className="task-experience-muted">
          This attempt has ended. Include your answer when continuing the task.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          onKeyDown={(event) => {
            // Number keys pick an option and Enter sends, as in the terminal; typing in
            // the response field keeps both keys for the text.
            const target = event.target as HTMLElement;
            if (target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) return;
            if (event.key === 'Enter' && target.tagName === 'INPUT') {
              event.preventDefault();
              void submit();
              return;
            }
            const option = /^[1-9]$/.test(event.key) ? options[Number(event.key) - 1] : undefined;
            if (option === undefined || sending || prompt.inputType === 'text') return;
            event.preventDefault();
            choose(option);
          }}
        >
          {options.length > 0 && prompt.inputType !== 'text' && (
            <fieldset disabled={sending} className="agent-question-options">
              <legend className="sr-only">
                {multiple ? 'Choose one or more responses' : 'Choose a response'}
              </legend>
              {options.map((option, index) => (
                <label
                  key={option}
                  className="agent-question-option"
                  data-selected={
                    (multiple ? selected.includes(option) : !custom && answer === option) ||
                    undefined
                  }
                >
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    name={`${id}-choice`}
                    checked={multiple ? selected.includes(option) : !custom && answer === option}
                    onChange={() => choose(option)}
                  />
                  <span>{option}</span>
                  {option === prompt.recommended && (
                    <span className="agent-question-recommended">Recommended</span>
                  )}
                  {index < 9 && (
                    <span className="agent-question-key" aria-hidden="true">
                      {index + 1}
                    </span>
                  )}
                </label>
              ))}
              {!multiple && prompt.allowOther !== false && (
                <label className="agent-question-option" data-selected={custom || undefined}>
                  <input
                    type="radio"
                    name={`${id}-choice`}
                    checked={custom}
                    onChange={() => {
                      setCustom(true);
                      setAnswer('');
                    }}
                  />
                  <span>Write a different response</span>
                </label>
              )}
            </fieldset>
          )}
          {freeform && (
            <label className="agent-question-custom">
              Your response
              <Textarea
                rows={3}
                maxLength={4000}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                disabled={sending}
                placeholder="Give the agent the detail it needs…"
              />
            </label>
          )}
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
          <div className="agent-question-footer">
            <span className="task-experience-muted">
              {continuing
                ? 'The agent stopped before you answered. Sending continues the task.'
                : 'Review your answer before sending.'}
            </span>
            <Button
              type="submit"
              disabled={sending || !hasResponse}
              loading={sending}
              loadingLabel={continuing ? 'Continuing…' : 'Sending…'}
            >
              <Send size={16} aria-hidden="true" />
              {continuing ? 'Continue with this answer' : 'Send response'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function displayAnswer(answer: string | null | undefined, multiple: boolean) {
  if (multiple && answer) {
    try {
      const values: unknown = JSON.parse(answer);
      if (Array.isArray(values) && values.every((value) => typeof value === 'string'))
        return values.join(', ');
    } catch {}
  }
  return answer;
}
