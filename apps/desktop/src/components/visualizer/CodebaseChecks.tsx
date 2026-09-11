import { Input } from '@jackalope/ui';
import {
  ArrowRight,
  CheckCheck,
  FileCode2,
  FileQuestion,
  Info,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import type { CodebaseReference, CodebaseSnapshot } from '../../lib/codebase';
import { Button } from '../ui/button';
export function CodebaseChecks({
  snapshot,
  cycles,
  unresolved,
  inspect,
}: {
  snapshot: CodebaseSnapshot;
  cycles: string[][];
  unresolved: CodebaseReference[];
  inspect: (path: string) => void;
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const visibleCycles = cycles.filter((cycle) => cycle.some(matches));
  const references = unresolved.filter((ref) => matches(`${ref.source} ${ref.specifier}`));
  const notes = snapshot.diagnostics.filter((note) => matches(`${note.path} ${note.message}`));
  const kinds = [
    {
      id: 'cycles',
      title: 'Dependency cycles',
      count: cycles.length,
      description: 'Groups of files that import back into one another.',
      icon: RefreshCw,
    },
    {
      id: 'references',
      title: 'Unresolved references',
      count: unresolved.length,
      description: 'Imports the scanner could not match to local files.',
      icon: FileQuestion,
    },
    {
      id: 'notes',
      title: 'Scan notes',
      count: snapshot.diagnostics.length,
      description: 'Files that could not be fully read or analyzed.',
      icon: Info,
    },
  ];
  const total = cycles.length + unresolved.length + snapshot.diagnostics.length;
  const show = (id: string) => filter === 'all' || filter === id;
  return (
    <div className="codebase-checks-visual">
      <div className="codebase-check-overview">
        {kinds.map(({ id, title, count, description, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(filter === id ? 'all' : id);
              setLimit(12);
            }}
          >
            <Icon size={22} />
            <strong>{count}</strong>
            <h2>{title}</h2>
            <p>{description}</p>
          </button>
        ))}
      </div>
      <div className="codebase-check-filter">
        <label>
          <Search size={17} />
          <Input
            className="task-input"
            aria-label="Search checks"
            placeholder="Find a file or reference…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(12);
            }}
          />
        </label>
        {filter !== 'all' && (
          <Button
            variant="ghost"
            onClick={() => {
              setFilter('all');
              setLimit(12);
            }}
          >
            Show all checks
          </Button>
        )}
      </div>
      <p className="task-muted text-xs">
        Findings from the scanned files. Generated files, aliases and type-only imports can produce
        findings that need no change.
      </p>
      {total === 0 ? (
        <div className="codebase-check-empty">
          <CheckCheck size={32} />
          <h3>No findings in this snapshot</h3>
          <p>No cycles, unresolved local imports or read errors were reported.</p>
        </div>
      ) : (
        <>
          {show('cycles') && visibleCycles.length > 0 && (
            <section className="codebase-finding-section">
              <h2>Dependency cycles</h2>
              <div className="codebase-finding-grid">
                {visibleCycles.slice(0, limit).map((cycle) => (
                  <article className="codebase-finding" key={cycle.join('|')}>
                    <header>
                      <RefreshCw size={18} />
                      <h3>{cycle.length} connected files</h3>
                    </header>
                    <p>
                      These files are mutually reachable through imports. Open a file to inspect its
                      actual links.
                    </p>
                    <div className="codebase-cycle-files">
                      {cycle.map((path) => (
                        <button type="button" key={path} onClick={() => inspect(path)}>
                          <FileCode2 size={16} />
                          <span>{path}</span>
                          <ArrowRight size={15} />
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {show('references') && references.length > 0 && (
            <section className="codebase-finding-section">
              <h2>Unresolved references</h2>
              <div className="codebase-finding-grid">
                {references.slice(0, limit).map((ref) => (
                  <button
                    type="button"
                    className="codebase-finding codebase-reference-finding"
                    key={`${ref.source}:${ref.line}:${ref.specifier}`}
                    onClick={() => inspect(ref.source)}
                  >
                    <header>
                      <FileQuestion size={18} />
                      <span>
                        {ref.status === 'outside root'
                          ? 'Outside this repository'
                          : 'Target not resolved'}
                      </span>
                      <ArrowRight size={16} />
                    </header>
                    <strong>{ref.specifier}</strong>
                    <p>
                      {ref.source}
                      <span>Line {ref.line}</span>
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}
          {show('notes') && notes.length > 0 && (
            <section className="codebase-finding-section">
              <h2>Scan notes</h2>
              <div className="codebase-finding-grid">
                {notes.slice(0, limit).map((note) => (
                  <article className="codebase-finding" key={`${note.path}:${note.message}`}>
                    <header>
                      <Info size={18} />
                      <h3>{note.path}</h3>
                    </header>
                    <p>{note.message}</p>
                    {snapshot.files.some((file) => file.path === note.path) && (
                      <Button variant="ghost" onClick={() => inspect(note.path)}>
                        Inspect file
                        <ArrowRight size={15} />
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          {(show('cycles') ? visibleCycles.length : 0) +
            (show('references') ? references.length : 0) +
            (show('notes') ? notes.length : 0) ===
            0 && (
            <div className="codebase-check-empty">
              <Search size={28} />
              <h3>No matching findings</h3>
              <p>Try another search or show all check types.</p>
            </div>
          )}
          {Math.max(
            show('cycles') ? visibleCycles.length : 0,
            show('references') ? references.length : 0,
            show('notes') ? notes.length : 0,
          ) > limit && (
            <Button variant="outline" onClick={() => setLimit(limit + 12)}>
              Show more findings
            </Button>
          )}
        </>
      )}
    </div>
  );
}
