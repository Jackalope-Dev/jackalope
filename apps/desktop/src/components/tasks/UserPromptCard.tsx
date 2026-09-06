import { Check, HelpCircle, Send } from 'lucide-react';
import { useState } from 'react';
import type { PendingUserPrompt } from '../../lib/task-runtime';
import { respondToPrompt } from '../../lib/task-runtime';
import { useExecutionStore } from '../../stores/executionStore';
import { useMascotStore } from '../../stores/mascotStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface UserPromptCardProps {
  runId: string;
  prompt: PendingUserPrompt;
  active: boolean;
}

export function UserPromptCard({ runId, prompt, active }: UserPromptCardProps) {
  const { refresh } = useExecutionStore();
  const { say, setMood } = useMascotStore();
  const [answerText, setAnswerText] = useState(prompt.defaultValue ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submitAnswer = async (answer: string) => {
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const delivered = await respondToPrompt(runId, prompt.id, answer.trim());
      if (!delivered)
        throw new Error(
          'This request is no longer waiting for a response. Refresh the task to see its current state.',
        );
      setMood('working');
      say('Your response is saved for the agent.', 3000);
      await refresh();
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  const isAnswered = prompt.status === 'answered';

  return (
    <div
      className={`p-4 rounded-2xl border transition-all duration-200 ${
        isAnswered
          ? 'bg-[var(--color-surface)] border-[var(--color-border)] opacity-85'
          : 'bg-gradient-to-br from-[var(--color-surface)] to-[var(--color-surface-elevated)] border-[var(--color-accent)] shadow-md shadow-[var(--color-accent)]/10'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center ${
              isAnswered
                ? 'bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]'
                : 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
            }`}
          >
            <HelpCircle size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                {isAnswered
                  ? 'Your response'
                  : active
                    ? 'The agent needs your input'
                    : 'Unanswered question'}
              </span>
              <Badge variant={isAnswered ? 'outline' : 'default'} className="text-xs px-1.5 py-0">
                {isAnswered ? 'Answered' : active ? 'Action Needed' : 'Task ended'}
              </Badge>
            </div>
            <span className="text-xs text-[var(--color-text-muted)]">
              {new Date(prompt.createdAt).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      <p className="text-sm text-[var(--color-text-primary)] font-medium leading-relaxed mb-3 pl-9">
        {prompt.question}
      </p>

      {error && (
        <p role="alert" className="text-xs text-[var(--color-danger)] mb-2 pl-9">
          {error}
        </p>
      )}

      {isAnswered ? (
        <div className="ml-9 p-2.5 rounded-xl bg-[var(--color-surface-sunken)] border border-[var(--color-border)] flex items-center gap-2 text-xs">
          <Check size={14} className="text-[var(--color-accent)] shrink-0" />
          <span className="text-[var(--color-text-muted)]">Your response:</span>
          <span className="font-semibold text-[var(--color-text-primary)]">{prompt.answer}</span>
        </div>
      ) : !active ? (
        <p className="ml-9 text-xs text-[var(--color-text-muted)]">
          This attempt has ended. Include your answer when continuing the task.
        </p>
      ) : (
        <div className="ml-9 space-y-2">
          {prompt.inputType === 'choice' && prompt.options.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {prompt.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  disabled={submitting}
                  onClick={() => void submitAnswer(opt)}
                  className="px-3 py-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-accent-subtle)] hover:border-[var(--color-accent)] text-xs font-medium text-[var(--color-text-primary)] transition-all cursor-pointer disabled:opacity-50"
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : prompt.inputType === 'confirmation' ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={submitting}
                onClick={() => void submitAnswer('Yes, proceed')}
                className="gap-1.5 text-xs"
              >
                <Check size={13} />
                Yes, proceed
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => void submitAnswer('No, adjust')}
                className="text-xs"
              >
                No, adjust
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitAnswer(answerText);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                maxLength={4000}
                aria-label="Your response to the agent"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                placeholder={prompt.defaultValue ?? 'Enter response for agent...'}
                disabled={submitting}
                className="task-input flex-1 min-w-0"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!answerText.trim() || submitting}
                className="gap-1.5 text-xs shrink-0"
              >
                <Send size={12} />
                {submitting ? 'Sending...' : 'Reply'}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
