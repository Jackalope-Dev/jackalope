import type { PendingUserPrompt } from '@jackalope/contracts/runs';
import { Button, Textarea } from '@jackalope/ui';
import { Check, MessageCircle, Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  AgentDecisionChip,
  AgentDecisionReason,
  deciderName,
  EscalationNote,
} from './AgentDecision';
import { HumanActionCard } from './HumanActionCard';
import './task-experience.css';
import { describeError } from '../../lib/errors';
import { ActionError } from '../ui/ActionError';

export function AgentQuestion(props: {
  prompt: PendingUserPrompt;
  active: boolean;
  agentName?: string;
  agentDetail?: string;
  onAnswer: (answer: string) => Promise<void>;
  /** Answers after the attempt ended, by continuing the task with the answer. */
  onContinue?: (answer: string) => Promise<void>;
  /** Replaces an agent's answer with the person's; omitted where overriding is unavailable. */
  onOverride?: (answer: string) => Promise<void>;
  onOpenLink?: (url: string) => void;
}) {
  if (props.prompt.humanAction)
    return (
      <HumanActionCard
        prompt={props.prompt}
        active={props.active}
        agentName={props.agentName}
        onAnswer={props.onAnswer}
        onOpenLink={props.onOpenLink}
      />
    );
  return <QuestionCard {...props} />;
}

function QuestionCard({
  prompt,
  active,
  agentName,
  agentDetail,
  onAnswer,
  onContinue,
  onOverride,
}: Parameters<typeof AgentQuestion>[0]) {
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
  const decidedBy = sent === null ? prompt.answeredBy : undefined;
  const deciding = prompt.status === 'deciding' && active && sent === null;
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
      setError(describeError(error));
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
          {decidedBy
            ? `${agentName ?? 'The agent'} asked`
            : answered
              ? 'Your response'
              : deciding
                ? 'An agent is deciding for you'
                : active
                  ? `${agentName ?? 'The agent'} needs your input`
                  : continuing
                    ? 'Answer to continue'
                    : 'Unanswered question'}
        </span>
        <span className="task-experience-meta">
          {decidedBy ? (
            <AgentDecisionChip agent={decidedBy.agent} confidence={decidedBy.confidence} />
          ) : answered ? (
            'Answered'
          ) : deciding ? (
            'You can still answer'
          ) : active ? (
            'Awaiting response'
          ) : (
            'Task ended'
          )}
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
      {prompt.escalation && !answered && (
        <EscalationNote category={prompt.escalation.category} reason={prompt.escalation.reason} />
      )}
      {decidedBy ? (
        <>
          <p ref={answerRef} tabIndex={-1} className="agent-question-answer" role="status">
            <Check size={18} aria-hidden="true" />
            <span>{displayAnswer(decidedBy.answer, multiple)}</span>
          </p>
          <AgentDecisionReason
            agent={decidedBy.agent}
            rationale={decidedBy.rationale}
            evidence={decidedBy.evidence}
          />
          {onOverride && <OverrideAnswer agent={decidedBy.agent} onOverride={onOverride} />}
        </>
      ) : answered ? (
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
          <ActionError error={error} />
          <div className="agent-question-footer">
            <span className="task-experience-muted">
              {continuing
                ? 'The agent stopped before you answered. Sending continues the task.'
                : deciding
                  ? 'Another agent is answering this for you. Sending your answer takes priority.'
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

/** Sends the person's corrected answer to an agent that relied on another agent's. */
export function OverrideAnswer({
  agent,
  onOverride,
}: {
  agent: string;
  onOverride: (answer: string) => Promise<void>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  if (done)
    return (
      <p className="task-experience-muted" role="status">
        Your answer was sent. The agent revisits work that relied on {deciderName(agent)}'s.
      </p>
    );
  if (!open)
    return (
      <div className="agent-question-footer">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Override
        </Button>
      </div>
    );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!text.trim() || sending) return;
        setSending(true);
        setError('');
        try {
          await onOverride(text.trim());
          setDone(true);
        } catch (cause) {
          setError(describeError(cause));
        } finally {
          setSending(false);
        }
      }}
    >
      <label className="agent-question-custom" htmlFor={`${id}-override`}>
        Your answer instead
      </label>
      <Textarea
        id={`${id}-override`}
        ref={field}
        rows={2}
        maxLength={4000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={sending}
      />
      <ActionError error={error} />
      <div className="agent-question-footer">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!text.trim()} loading={sending} loadingLabel="Sending…">
          Send my answer
        </Button>
      </div>
    </form>
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
