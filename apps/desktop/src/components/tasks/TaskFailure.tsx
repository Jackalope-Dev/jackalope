import { Button, Disclosure, DisclosureSummary, InlineNotice } from '@jackalope/ui';
import { RotateCw } from 'lucide-react';
import type { FailureKind, PreparationRecord } from '../../lib/run-types';

/** What to do next for failures whose kind has one clear remedy. */
const NEXT_STEP: Partial<Record<FailureKind, string>> = {
  authentication: 'Sign in to this agent’s account in Agents, then retry.',
  model_unavailable: 'Choose another model for this agent, then retry.',
  context_too_long:
    'Start a new task with a narrower request; continuing resends the full context.',
};

/** The setup command's own output, which is usually where the real cause is. */
function SetupOutput({ preparation }: { preparation: PreparationRecord }) {
  const seconds = Math.round(preparation.durationMs / 1000);
  return (
    <Disclosure>
      <DisclosureSummary>
        Setup output ({preparation.command}
        {preparation.attempts > 1 && `, ${preparation.attempts} attempts`}, {seconds}s)
      </DisclosureSummary>
      <pre className="task-output">{preparation.outputTail || 'No output was recorded.'}</pre>
    </Disclosure>
  );
}

export function TaskFailure({
  message,
  kind,
  preparation,
  onInspect,
  onRetry,
  retrying,
}: {
  message: string;
  kind?: FailureKind | null;
  /** Shown when the attempt died in project setup rather than in the agent. */
  preparation?: PreparationRecord | null;
  onInspect: () => void;
  /** Absent when this attempt cannot be retried, for example once it is superseded. */
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const firstLine = failureSummary(message);
  const summary = firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
  const failedSetup = !!preparation && !preparation.success;
  // Jackalope's own messages, such as Gemini's sign-in error, can already say what to do.
  const nextStep =
    kind && !/\b(sign in|choose another|start a new)\b/i.test(message)
      ? NEXT_STEP[kind]
      : undefined;
  return (
    <InlineNotice
      tone="error"
      className="task-failure"
      action={
        <>
          {onRetry && (
            <Button variant="outline" disabled={retrying} onClick={onRetry}>
              <RotateCw size={16} />
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          )}
          <Button variant="ghost" onClick={onInspect}>
            Inspect activity
          </Button>
        </>
      }
    >
      <p>{summary || 'The task ended with an error.'}</p>
      {nextStep && <p className="task-muted">{nextStep}</p>}
      {onRetry && (
        <p className="task-muted">
          A retry starts a fresh attempt at the same task and continues in this workspace when the
          agent left it clean.
        </p>
      )}
      {failedSetup && <SetupOutput preparation={preparation} />}
      {message.trim() !== summary && (
        <Disclosure>
          <DisclosureSummary>Error details</DisclosureSummary>
          <pre className="task-output">{message}</pre>
        </Disclosure>
      )}
    </InlineNotice>
  );
}

/**
 * The line shown for a failure. Providers often wrap the useful text in a JSON
 * body after a short prefix, so a trailing object's "message" is preferred.
 */
function failureSummary(message: string) {
  const text = message.trim();
  const firstLine = text.split('\n')[0];
  const start = text.indexOf('{');
  if (start < 0 || start > firstLine.length) return firstLine;
  try {
    const body = JSON.parse(text.slice(start));
    const detail = body?.message ?? body?.error?.message ?? body?.error;
    if (typeof detail === 'string' && detail.trim()) {
      const prefix = text.slice(0, start).trim().replace(/:$/, '');
      return prefix ? `${prefix}: ${detail.trim()}` : detail.trim();
    }
  } catch {}
  return firstLine;
}
