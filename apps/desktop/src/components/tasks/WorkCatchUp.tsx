import { Badge, IconButton, Panel } from '@jackalope/ui';
import { ArrowRight, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  buildCatchUp,
  type CatchUpDecision,
  type CatchUpEvent,
  type CatchUpPicture,
  type CatchUpRisk,
} from '../../lib/catch-up';
import { workPresence } from '../../lib/task-collection';
import { nativeTask } from '../../lib/task-runtime';
import { compactElapsed } from '../../lib/work-signals';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { useChangeStats, useWorkSignalsStore } from '../../stores/workSignalsStore';
import { selectWorkItem, useWorkspaceWork } from '../layout/WorkSidebar';
import { Button } from '../ui/button';
import './work-catch-up.css';

const PICTURE_LIMIT = 3;

const riskBadge: Record<CatchUpRisk, 'success' | 'warning' | 'danger' | 'outline'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  unknown: 'outline',
};

const riskLabel: Record<CatchUpRisk, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  unknown: 'Risk unknown',
};

function Picture({
  picture,
  title,
  onOpen,
}: {
  picture: CatchUpPicture;
  title: string;
  onOpen: () => void;
}) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let canceled = false;
    let url = '';
    nativeTask<number[]>('task_screenshot', {
      runId: picture.runId,
      screenshotId: picture.image.id,
    })
      .then((bytes) => {
        if (canceled) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        setSource(url);
      })
      .catch(() => {
        if (!canceled) setFailed(true);
      });
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [picture.runId, picture.image.id]);
  if (failed) return null;
  return (
    <figure className="catch-up-picture">
      <button type="button" onClick={onOpen} aria-label={`Open ${title}`}>
        {source ? (
          <img src={source} alt={`Screenshot from ${title}`} onError={() => setFailed(true)} />
        ) : (
          <span className="catch-up-picture-loading" role="status">
            Loading screenshot…
          </span>
        )}
      </button>
      <figcaption>{title}</figcaption>
    </figure>
  );
}

function Happened({ event, onOpen }: { event: CatchUpEvent; onOpen: () => void }) {
  return (
    <li className="catch-up-event" data-tone={event.tone}>
      <button type="button" onClick={onOpen}>
        <span className="catch-up-event-line">
          <strong>{event.title}</strong>
          <span>{/[.!?…]$/.test(event.outcome) ? event.outcome : `${event.outcome}.`}</span>
        </span>
        {event.detail && <span className="catch-up-event-detail">{event.detail}</span>}
        {event.project && <span className="catch-up-project">{event.project}</span>}
      </button>
    </li>
  );
}

function Waiting({ item, onOpen }: { item: CatchUpDecision; onOpen: () => void }) {
  return (
    <li className="catch-up-decision">
      <div className="catch-up-decision-heading">
        <h4>{item.title}</h4>
        {item.project && <span className="catch-up-project">{item.project}</span>}
      </div>
      <p className="catch-up-decision-call">{item.decision}</p>
      <dl className="catch-up-facts">
        <div>
          <dt>What it changes</dt>
          <dd>{item.changes}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{item.evidence.join(' · ')}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>
            <Badge variant={riskBadge[item.risk.level]}>{riskLabel[item.risk.level]}</Badge>{' '}
            {item.risk.reason}
          </dd>
        </div>
      </dl>
      <div className="catch-up-decision-actions">
        {item.suggestion && (
          <p className="catch-up-suggestion">
            <span className="catch-up-suggestion-label">Suggested next step:</span>{' '}
            {item.suggestion}
          </p>
        )}
        <Button variant="outline" onClick={onOpen}>
          {item.action}
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

/**
 * A short catch-up above the work list after the person has been away: what waits
 * on them, what finished or failed meanwhile and every decision left to them. Built
 * locally from recorded work; it never asks a model.
 */
export function WorkCatchUp() {
  const since = usePresenceStore((state) => state.awaySince);
  const work = useWorkspaceWork();
  const runs = useExecutionStore((state) => state.runs);
  const sessionRuns = useLiveSessionStore((state) => state.runs);
  const queue = useManagedTaskStore((state) => state.queue);
  const seen = useWorkSignalsStore((state) => state.seen);
  const allRuns = useMemo(
    () => [...new Map([...runs, ...sessionRuns].map((run) => [run.id, run])).values()],
    [runs, sessionRuns],
  );
  const waitingRuns = since
    ? work
        .filter((item) => item.stage === 'attention' || item.stage === 'review')
        .map((item) => item.run)
    : [];
  const stats = useChangeStats(waitingRuns);
  const changedFiles = useMemo(
    () => Object.fromEntries(Object.entries(stats).map(([id, entry]) => [id, entry.value.files])),
    [stats],
  );
  const catchUp = useMemo(
    () =>
      since
        ? buildCatchUp({
            items: work,
            runs: allRuns,
            queue,
            since,
            seen,
            changedFiles,
            actionFor: (item) => workPresence(item).action,
          })
        : null,
    [since, work, allRuns, queue, seen, changedFiles],
  );
  if (!since || !catchUp) return null;
  const dismiss = () => {
    usePresenceStore.getState().dismiss();
    // Keep keyboard focus on the page once the summary is gone.
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.work-item')?.focus());
  };
  const pictures = catchUp.happened.filter((event) => event.picture).slice(0, PICTURE_LIMIT);
  const away = compactElapsed(since, Date.now());
  return (
    <Panel className="catch-up" aria-labelledby="catch-up-title">
      <header className="catch-up-header">
        <div>
          <h2 id="catch-up-title">Since you left</h2>
          <p className="catch-up-headline">{catchUp.headline}</p>
        </div>
        <IconButton label="Dismiss catch-up" onClick={dismiss}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </header>
      {catchUp.happened.length > 0 && (
        <section className="catch-up-section" aria-labelledby="catch-up-happened">
          <h3 id="catch-up-happened">While you were away{away ? <span> · {away}</span> : null}</h3>
          {pictures.length > 0 && (
            <div className="catch-up-pictures">
              {pictures.map((event) =>
                event.picture ? (
                  <Picture
                    key={event.item.id}
                    picture={event.picture}
                    title={event.title}
                    onOpen={() => selectWorkItem(event.item)}
                  />
                ) : null,
              )}
            </div>
          )}
          <ul className="catch-up-events">
            {catchUp.happened.map((event) => (
              <Happened
                key={event.item.id}
                event={event}
                onOpen={() => selectWorkItem(event.item)}
              />
            ))}
          </ul>
          {catchUp.moreHappened > 0 && (
            <p className="catch-up-more">
              {catchUp.moreHappened} more {catchUp.moreHappened === 1 ? 'update is' : 'updates are'}{' '}
              in the work list below.
            </p>
          )}
        </section>
      )}
      {catchUp.waiting.length > 0 && (
        <section className="catch-up-section" aria-labelledby="catch-up-waiting">
          <h3 id="catch-up-waiting">Waiting on you</h3>
          <ol className="catch-up-decisions">
            {catchUp.waiting.map((item) => (
              <Waiting key={item.item.id} item={item} onOpen={() => selectWorkItem(item.item)} />
            ))}
          </ol>
        </section>
      )}
    </Panel>
  );
}
