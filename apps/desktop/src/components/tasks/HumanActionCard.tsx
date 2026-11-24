import type { PendingUserPrompt } from '@jackalope/contracts/runs';
import { Button, LinkButton, Textarea } from '@jackalope/ui';
import { Check, Hand } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import './agent-decision.css';
import './task-experience.css';
import { describeError } from '@jackalope/contracts/errors';
import { isSystemSettingsLink } from '../../lib/native/env';
import { ActionError } from '../ui/ActionError';

const DONE = 'Done';
const DECLINED = 'Declined';

const kindLabels = {
  secret: 'Add a secret',
  sign_in: 'Sign in',
  payment: 'Payment',
  account: 'Create an account',
  other: 'A step only you can take',
} as const;

/** The agent receives `Done` or `Declined`, then any note on the next line. */
function humanActionAnswer(choice: string, note: string) {
  const trimmed = note.trim();
  return trimmed ? `${choice}\nNote: ${trimmed}` : choice;
}

/**
 * Something only the person can do: sign in, pay, create an account or add a secret.
 * Agents never answer these; the asking agent waits for Done or Declined.
 */
export function HumanActionCard({
  prompt,
  active,
  agentName,
  onAnswer,
  onOpenLink,
}: {
  prompt: PendingUserPrompt;
  active: boolean;
  agentName?: string;
  onAnswer: (answer: string) => Promise<void>;
  onOpenLink?: (url: string) => void;
}) {
  const id = useId();
  const action = prompt.humanAction;
  const [note, setNote] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  if (!action) return null;
  const answered = prompt.status === 'answered' || sent !== null;
  const answer = (prompt.answer ?? sent ?? '').split('\n')[0];
  const respond = async (choice: string) => {
    if (!active || answered || inFlight.current) return;
    inFlight.current = true;
    setSending(choice);
    setError('');
    try {
      const value = humanActionAnswer(choice, note);
      await onAnswer(value);
      setSent(value);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      inFlight.current = false;
      setSending(null);
    }
  };
  const open = (url: string) =>
    onOpenLink ? onOpenLink(url) : window.open(url, '_blank', 'noopener,noreferrer');
  // Views of another device's work pass no onOpenLink, and its System Settings are not here.
  const settingsLink = !!action.url && isSystemSettingsLink(action.url);
  return (
    <section
      className="agent-question"
      data-answered={answered || undefined}
      aria-labelledby={`${id}-title`}
    >
      <div className="task-experience-heading">
        <span className="task-experience-icon">
          <Hand size={18} aria-hidden="true" />
        </span>
        <span>{answered ? 'Your action' : 'Needs you'}</span>
        <span className="task-experience-meta">
          {answered ? answer : active ? kindLabels[action.kind] : 'Task ended'}
        </span>
      </div>
      <h3 id={`${id}-title`} className="agent-question-title">
        {prompt.question}
      </h3>
      {!answered && (
        <>
          <p className="human-action-steps">{action.instructions}</p>
          {action.kind === 'secret' && (
            <p className="human-action-hint">
              Add it under Project settings → Secrets
              {action.secretName ? (
                <>
                  {' '}
                  as <code>{action.secretName}</code>
                </>
              ) : null}
              . Never paste a secret into a conversation.
            </p>
          )}
          {action.url && (!settingsLink || onOpenLink) && (
            <p>
              <LinkButton external onClick={() => open(action.url ?? '')}>
                {settingsLink ? 'Open System Settings' : `Open ${linkHost(action.url)}`}
              </LinkButton>
            </p>
          )}
        </>
      )}
      {answered ? (
        <p className="agent-question-answer" role="status">
          <Check size={18} aria-hidden="true" />
          <span>
            {answer === DECLINED
              ? `You told ${agentName ?? 'the agent'} you could not do this.`
              : `You told ${agentName ?? 'the agent'} it is done.`}
          </span>
        </p>
      ) : active ? (
        <>
          <label className="agent-question-custom">
            Note for {agentName ?? 'the agent'} (optional)
            <Textarea
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={sending !== null}
              placeholder="Anything it should know, such as which account you used"
            />
          </label>
          <ActionError error={error} />
          <div className="agent-question-footer">
            <span className="task-experience-muted">
              {agentName ?? 'The agent'} waits until you finish.
            </span>
            <div className="human-action-actions">
              <Button
                variant="outline"
                disabled={sending !== null}
                loading={sending === DECLINED}
                loadingLabel="Sending…"
                onClick={() => void respond(DECLINED)}
              >
                I can't do this
              </Button>
              <Button
                disabled={sending !== null}
                loading={sending === DONE}
                loadingLabel="Sending…"
                onClick={() => void respond(DONE)}
              >
                Done
              </Button>
            </div>
          </div>
        </>
      ) : (
        <p className="task-experience-muted">
          This attempt has ended. Continue the task once you have done this.
        </p>
      )}
    </section>
  );
}

function linkHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'link';
  }
}
