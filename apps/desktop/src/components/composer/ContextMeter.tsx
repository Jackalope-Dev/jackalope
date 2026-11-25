import { Tooltip } from '@jackalope/ui';
import { compactTokens, contextShare } from '../../lib/reasoning-effort';
import type { TaskRun } from '../../lib/run-types';
import './composer.css';

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * How much of the agent's context the latest model call used, as the provider reported
 * it. Renders nothing when the provider reports no usage; without a reported window it
 * shows the count alone.
 */
export function ContextMeter({ run }: { run?: TaskRun | null }) {
  const context = contextShare(run?.context);
  if (!context) return null;
  const used = context.used.toLocaleString('en-US');
  const description = context.window
    ? `Context: ${used} of ${context.window.toLocaleString('en-US')} tokens (${Math.round((context.share ?? 0) * 100)}%), as the agent reported after its latest model call.`
    : `Context: ${used} tokens after the agent's latest model call. The agent did not report its context window.`;
  return (
    <Tooltip content={description}>
      <button
        type="button"
        className="context-meter"
        data-level={context.level}
        aria-label={description}
      >
        {context.share !== null && (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle
              className="context-meter-track"
              cx="8"
              cy="8"
              r={RADIUS}
              fill="none"
              strokeWidth="2"
            />
            <circle
              className="context-meter-fill"
              cx="8"
              cy="8"
              r={RADIUS}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${context.share * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              transform="rotate(-90 8 8)"
            />
          </svg>
        )}
        <span aria-hidden="true">
          {context.share !== null
            ? `${Math.round(context.share * 100)}%`
            : `${compactTokens(context.used)} tokens`}
        </span>
      </button>
    </Tooltip>
  );
}
