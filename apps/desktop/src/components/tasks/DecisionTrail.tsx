import { Badge } from '@jackalope/ui';
import { CircleAlert, CircleCheck, CircleDashed, ExternalLink } from 'lucide-react';
import {
  decisionTrail,
  missingPointers,
  type PointerState,
  pointerStates,
  supersededBy,
} from '../../lib/decision-trail';
import type { DecisionEntry, TaskRun } from '../../lib/task-runtime';
import './decision-trail.css';

const POINTER_LABEL: Record<PointerState, string> = {
  found: 'Found',
  missing: 'Not found',
  external: 'Not checked locally',
  unchecked: 'Checked when the attempt ends',
};

const POINTER_ICON = {
  found: CircleCheck,
  missing: CircleAlert,
  external: ExternalLink,
  unchecked: CircleDashed,
} satisfies Record<PointerState, unknown>;

const time = (at: string) => {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * The decisions an agent reported across a task's attempts: time, decision, why,
 * evidence and result. Renders nothing for work without a trail.
 */
export function DecisionTrail({
  attempts,
  currentId,
}: {
  attempts: Pick<TaskRun, 'id' | 'startedAt' | 'decisions'>[];
  currentId?: string;
}) {
  const groups = decisionTrail(attempts, currentId);
  if (!groups.length) return null;
  const corrected = supersededBy(groups);
  const entries = new Map(groups.flatMap((group) => group.entries).map((e) => [e.id, e]));
  const count = entries.size;
  const missing = missingPointers(groups);
  const marked = groups.length > 1 || groups[0]?.attempt !== 1;
  return (
    <section className="decision-trail" aria-label="Decision log">
      <div className="decision-trail-heading">
        <h3>Decision log</h3>
        <span className="decision-trail-meta">
          {count} {count === 1 ? 'entry' : 'entries'}
          {missing > 0 && (
            <span className="decision-trail-missing">
              {' · '}
              {missing} {missing === 1 ? 'pointer' : 'pointers'} not found
            </span>
          )}
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.runId} className="decision-trail-group">
          {marked && (
            <p className="decision-trail-marker">
              Attempt {group.attempt} · started {time(group.startedAt)}
            </p>
          )}
          <ol className="decision-trail-list">
            {group.entries.map((entry) => (
              <TrailEntry
                key={entry.id}
                entry={entry}
                correctedBy={corrected.get(entry.id)}
                corrects={entry.supersedes ? entries.get(entry.supersedes) : undefined}
              />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

function TrailEntry({
  entry,
  correctedBy,
  corrects,
}: {
  entry: DecisionEntry;
  correctedBy?: DecisionEntry;
  corrects?: DecisionEntry;
}) {
  const pointers = pointerStates(entry);
  return (
    <li className="decision-trail-entry" data-superseded={correctedBy ? true : undefined}>
      <time className="decision-trail-time" dateTime={entry.at}>
        {time(entry.at)}
      </time>
      <div className="decision-trail-body">
        <p className="decision-trail-decision">
          <span className="decision-trail-phase">{entry.phase}</span>
          <span>{entry.decision}</span>
          {correctedBy && <Badge variant="outline">Superseded</Badge>}
        </p>
        <p className="decision-trail-why">{entry.why}</p>
        {corrects && <p className="decision-trail-note">Corrects “{corrects.decision}”</p>}
        {pointers.length ? (
          <ul className="decision-trail-evidence" aria-label="Evidence">
            {pointers.map(({ pointer, state, note }) => {
              const Icon = POINTER_ICON[state];
              const label =
                note && state === 'missing'
                  ? `${POINTER_LABEL[state]}: ${note}`
                  : POINTER_LABEL[state];
              return (
                <li
                  key={pointer}
                  className="decision-trail-pointer"
                  data-state={state}
                  title={label}
                >
                  <Icon size={14} aria-hidden="true" />
                  <code>{pointer}</code>
                  {state === 'missing' ? (
                    <span className="decision-trail-pointer-state">{label}</span>
                  ) : (
                    <span className="sr-only">{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="decision-trail-note">No evidence given</p>
        )}
      </div>
      <span className="decision-trail-result">
        <span className="sr-only">Result: </span>
        {entry.result}
      </span>
    </li>
  );
}
