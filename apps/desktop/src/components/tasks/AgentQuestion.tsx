import { Check, MessageCircle, Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { PendingUserPrompt } from '../../lib/task-runtime';
import { Button } from '../ui/button';
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
  const freeform = prompt.inputType === 'text' || options.length === 0 || custom;
  const submit = async () => {
    if (!active || answered || inFlight.current || !answer.trim()) return;
    inFlight.current = true;
    setSending(true);
    setError('');
    try {
      await onAnswer(answer.trim());
      setSent(answer.trim());
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
          <span>{prompt.answer ?? sent}</span>
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
              <legend className="sr-only">Choose a response</legend>
              {options.map((option) => (
                <label
                  key={option}
                  className="agent-question-option"
                  data-selected={(!custom && answer === option) || undefined}
                >
                  <input
                    type="radio"
                    name={`${id}-choice`}
                    checked={!custom && answer === option}
                    onChange={() => {
                      setCustom(false);
                      setAnswer(option);
                    }}
                  />
                  <span>{option}</span>
                </label>
              ))}
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
            </fieldset>
          )}
          {freeform && (
            <label className="agent-question-custom">
              Your response
              <textarea
                rows={3}
                maxLength={4000}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                disabled={sending}
                placeholder="Give the agent the detail it needs…"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="task-experience-error">
              {error}
            </p>
          )}
          <div className="agent-question-footer">
            <span className="task-experience-muted">Review your answer before sending.</span>
            <Button type="submit" disabled={sending || !answer.trim()}>
              <Send size={16} aria-hidden="true" />
              {sending ? 'Sending…' : 'Send response'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
