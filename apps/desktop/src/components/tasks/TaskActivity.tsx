import { Input } from '@jackalope/ui';
import { ChevronRight, ListFilter, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '../ui/button';
import { CodeSurface } from './CodeSurface';
import './task-experience.css';

export function TaskActivity({ entries, active }: { entries: string[]; active: boolean }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const matching = entries
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.toLowerCase().includes(query.trim().toLowerCase()));
  const visible = matching.slice(-limit);
  return (
    <section className="task-activity" aria-label="Task activity">
      <div className="task-experience-summary">
        <ListFilter size={18} aria-hidden="true" />
        <span>Activity</span>
        <span className="task-experience-meta">{entries.length} retained entries</span>
      </div>
      <div className="task-activity-body">
        <label className="task-activity-search" htmlFor={id}>
          <Search size={16} aria-hidden="true" />
          <Input
            id={id}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(20);
            }}
            placeholder="Find a command, file, or message…"
            aria-label="Search activity"
          />
        </label>
        <p className="task-experience-muted" role="status">
          {query.trim()
            ? `${matching.length} matching entries`
            : 'Recent messages reported by the agent. Entries are not completion or verification results.'}
        </p>
        {matching.length > limit && (
          <Button variant="ghost" onClick={() => setLimit((value) => value + 40)}>
            Show earlier entries ({matching.length - limit})
          </Button>
        )}
        <ol className="task-activity-list">
          {visible.map(({ text, index }) => (
            <li key={`${index}:${text}`}>
              <details>
                <summary className="task-activity-entry">
                  <ChevronRight size={15} aria-hidden="true" />
                  <span className="task-activity-number">{index + 1}</span>
                  <span>{text.trim().split('\n')[0] || 'Agent activity'}</span>
                </summary>
                <CodeSurface label={`Activity entry ${index + 1}`}>{text}</CodeSurface>
              </details>
            </li>
          ))}
        </ol>
        {!matching.length && (
          <p className="task-experience-muted">
            {entries.length
              ? 'No entries match. Try a different search.'
              : active
                ? 'Waiting for the agent to report activity.'
                : 'No activity was recorded for this attempt.'}
          </p>
        )}
      </div>
    </section>
  );
}
