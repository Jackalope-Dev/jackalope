import { Badge } from '@jackalope/ui';
import { animate, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotionPreference } from '../../hooks/useReducedMotionPreference';
import { type AutonomyEntry, type PlanAutonomy, planCommands } from '../../lib/plan-mode';
import {
  AgentDecisionChip,
  AgentDecisionReason,
  deciderName,
  EscalationNote,
} from '../tasks/AgentDecision';
import { OverrideAnswer } from '../tasks/AgentQuestion';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';

const kindLabels: Record<AutonomyEntry['kind'], string> = {
  question: 'Question',
  round: 'Swarm round',
  deviation: 'Deviation',
};

/** A shared motion duration from the brand tokens, in seconds. */
function motionSeconds(token: string, fallback: number) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const ms = value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : fallback;
}

/** Counts up to `value` when it changes; static with reduced motion. */
function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotionPreference();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      from.current = value;
      setShown(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: motionSeconds('--motion-slow', 0.24) * 2,
      ease: 'easeOut',
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduced]);
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}

function EntryRow({
  planId,
  entry,
  onChanged,
}: {
  planId: string;
  entry: AutonomyEntry;
  onChanged: () => Promise<void>;
}) {
  const decided = entry.outcome === 'decided' && entry.decider;
  return (
    <>
      <div className="plan-autonomy-row-head">
        <span className="plan-muted">{kindLabels[entry.kind]}</span>
        {decided && entry.decider ? (
          <AgentDecisionChip agent={entry.decider} confidence={entry.confidence ?? undefined} />
        ) : entry.outcome === 'deciding' ? (
          <Badge variant="accent">
            {entry.decider ? `${deciderName(entry.decider)} is deciding` : 'Deciding'}
          </Badge>
        ) : entry.outcome === 'person' ? (
          <Badge>You answered first</Badge>
        ) : (
          <Badge variant="warning">Sent to you</Badge>
        )}
      </div>
      <p className="plan-autonomy-subject">{entry.subject}</p>
      {decided && entry.answer && (
        <p className="plan-prose">
          {entry.overridden ? (
            <>
              <s>{entry.answer}</s> · You answered: {entry.overridden.answer}
            </>
          ) : (
            entry.answer
          )}
        </p>
      )}
      {entry.outcome === 'escalated' && entry.reason && (
        <EscalationNote category={entry.category ?? 'decider'} reason={entry.reason} />
      )}
      {decided && entry.decider && (
        <AgentDecisionReason
          agent={entry.decider}
          rationale={entry.rationale}
          evidence={entry.evidence}
        />
      )}
      {decided && entry.decider && entry.kind === 'question' && !entry.overridden && (
        <OverrideAnswer
          agent={entry.decider}
          onOverride={async (answer) => {
            await planCommands.overrideDecision(planId, entry.id, answer);
            await onChanged();
          }}
        />
      )}
    </>
  );
}

/**
 * What agents decided for the person on this plan, what waits on them, and why
 * anything was sent to them instead.
 */
export function PlanAutonomyPanel({
  planId,
  autonomy,
  onChanged,
}: {
  planId: string;
  autonomy: PlanAutonomy;
  onChanged: () => Promise<void>;
}) {
  const reduced = useReducedMotionPreference();
  const enabled = [
    autonomy.questions && 'routine questions',
    autonomy.rounds && 'swarm rounds',
    autonomy.deviations && 'deviations within scope',
  ].filter(Boolean);
  const entries = autonomy.entries.slice(0, 12);
  return (
    <section className="plan-autonomy" aria-labelledby={`${planId}-autonomy`}>
      <WorkspaceSectionHeading
        title="Autonomy"
        titleId={`${planId}-autonomy`}
        level={3}
        description={
          enabled.length
            ? `Agents decide ${enabled.join(', ')}. Sign-ins, payment, secrets and changes of direction always come to you.`
            : 'Agents decide nothing on this plan; everything comes to you.'
        }
      />
      {autonomy.blocked && <InlineNotice tone="warning">{autonomy.blocked}</InlineNotice>}
      <dl className="plan-autonomy-stats">
        <div>
          <dt>Decided by agents</dt>
          <dd>
            <CountUp value={autonomy.decided} />
          </dd>
        </div>
        <div data-attention={autonomy.waiting > 0 || undefined}>
          <dt>Waiting on you</dt>
          <dd>
            <CountUp value={autonomy.waiting} />
          </dd>
        </div>
        <div>
          <dt>Limit used</dt>
          <dd>
            {autonomy.used} of {autonomy.limit}
          </dd>
        </div>
      </dl>
      {entries.length > 0 && (
        <ol className="plan-autonomy-list" aria-label="Agent decisions, newest first">
          {entries.map((entry) => (
            <motion.li
              key={entry.id}
              className="plan-autonomy-row"
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: motionSeconds('--motion-base', 0.18), ease: 'easeOut' }}
            >
              <EntryRow planId={planId} entry={entry} onChanged={onChanged} />
            </motion.li>
          ))}
        </ol>
      )}
    </section>
  );
}
