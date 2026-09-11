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
  onAnswer,
}: {
  prompt: PendingUserPrompt;
  active: boolean;
  onAnswer: (answer: string) => Promise<void>;
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
  useEffect(() => {
    if (sent !== null) answerRef.current?.focus();
  }, [sent]);
  const freeform = !multiple && (prompt.inputType === 'text' || options.length === 0 || custom);
  const response = multiple ? JSON.stringify(selected) : answer.trim();
  const hasResponse = multiple ? selected.length > 0 : !!answer.trim();
  const submit = async () => {
    if (!active || answered || inFlight.current || !hasResponse) return;
    inFlight.current = true;
    setSending(true);
    setError('');
    try {
      await onAnswer(response);
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
              ? 'The agent needs your input'
              : 'Unanswered question'}
        </span>
        <span className="task-experience-meta">
          {answered ? 'Answered' : active ? 'Awaiting response' : 'Task ended'}
        </span>
      </div>
      <h3 id={`${id}-question`} className="agent-question-title">
        {prompt.question}
      </h3>
      {answered ? (
        <p ref={answerRef} tabIndex={-1} className="agent-question-answer" role="status">
          <Check size={18} aria-hidden="true" />
          <span>{displayAnswer(prompt.answer ?? sent, multiple)}</span>
        </p>
      ) : !active ? (
        <p className="task-experience-muted">
          This attempt has ended. Include your answer when continuing the task.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {options.length > 0 && prompt.inputType !== 'text' && (
            <fieldset disabled={sending} className="agent-question-options">
              <legend className="sr-only">
                {multiple ? 'Choose one or more responses' : 'Choose a response'}
              </legend>
              {options.map((option) => (
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
                    onChange={() => {
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
                    }}
                  />
                  <span>{option}</span>
                </label>
              ))}
              {!multiple && (
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
            <span className="task-experience-muted">Review your answer before sending.</span>
            <Button type="submit" disabled={sending || !hasResponse}>
              <Send size={16} aria-hidden="true" />
              {sending ? 'Sending…' : 'Send response'}
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
