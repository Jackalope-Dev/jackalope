import { Activity, CircleAlert, FilePenLine, FileSearch, Search, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { liveActivity } from '../../lib/task-live-activity';
import { elapsedLabel, isActive, type TaskRun } from '../../lib/task-runtime';
import './task-live-activity.css';

const icons = {
  activity: Activity,
  attention: CircleAlert,
  read: FileSearch,
  edit: FilePenLine,
  search: Search,
  check: Terminal,
};

export function TaskLiveActivity({ run }: { run: TaskRun }) {
  const active = isActive(run);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (!document.hidden) tick((value) => value + 1);
    }, 2000);
    return () => clearInterval(timer);
  }, [active]);
  const state = liveActivity(run);
  if (!state) return null;
  const Icon = icons[state.kind];
  const elapsed = Number.isFinite(Date.parse(state.since)) ? elapsedLabel(state.since) : null;
  return (
    <section className="task-live-activity" aria-label="Live activity">
      <div className="task-live-heading">
        <span role="status">{state.phase}</span>
        {elapsed && (
          <span className="task-live-elapsed">
            <span className="sr-only">Elapsed: </span>
            {elapsed}
          </span>
        )}
      </div>
      <div className="task-live-current" data-kind={state.kind}>
        <Icon size={16} aria-hidden="true" />
        <span>{state.current}</span>
      </div>
      {!!state.recent.length && (
        <ol className="task-live-recent" aria-label="Recent activity">
          {state.recent.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
