import { Disclosure, DisclosureSummary, SearchField } from '@jackalope/ui';
import { ListFilter } from 'lucide-react';
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
        <SearchField
          id={id}
          value={query}
          placeholder="Find a command, file, or message…"
          aria-label="Search activity"
          onValueChange={(value) => {
            setQuery(value);
            setLimit(20);
          }}
          containerClassName="task-activity-search"
        />
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
              <Disclosure>
                <DisclosureSummary className="task-activity-entry">
                  <span className="task-activity-number">{index + 1}</span>
                  <span>{text.trim().split('\n')[0] || 'Agent activity'}</span>
                </DisclosureSummary>
                <CodeSurface label={`Activity entry ${index + 1}`}>{text}</CodeSurface>
              </Disclosure>
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
