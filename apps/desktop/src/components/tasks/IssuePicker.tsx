import { Button, Checkbox, Input, Select, SelectItem } from '@jackalope/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Issue, type IssuePage, issuePrompt, issueUrl } from '../../lib/issues';
import { nativeTask } from '../../lib/task-runtime';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { openSettings } from '../layout/navigation';
import { InlineNotice } from '../ui/InlineNotice';
import './issue-picker.css';

export function IssuePicker({
  projectPath,
  onDraft,
}: {
  projectPath: string;
  onDraft: (text: string) => void;
}) {
  const [provider, setProvider] = useState('github');
  const [kind, setKind] = useState('issue');
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(true);
  const [items, setItems] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const load = useCallback(
    async (cursor?: string) => {
      const current = ++revision.current;
      setBusy(true);
      setError('');
      if (!cursor) {
        setItems([]);
        setSelected(null);
        setNext(null);
      }
      try {
        const result = await nativeTask<IssuePage>('project_issues', {
          projectPath,
          provider,
          kind: provider === 'github' ? kind : 'issue',
          query,
          mine,
          cursor: cursor ?? null,
        });
        if (current !== revision.current) return;
        setItems((previous) => [
          ...new Map(
            [...(cursor ? previous : []), ...result.items].map((issue) => [issue.url, issue]),
          ).values(),
        ]);
        setNext(result.next);
      } catch (cause) {
        if (current === revision.current) setError(String(cause));
      } finally {
        if (current === revision.current) setBusy(false);
      }
    },
    [projectPath, provider, kind, query, mine],
  );
  useEffect(() => {
    setSelected(null);
    setItems([]);
    setNext(null);
    setBusy(true);
    setError('');
    const timer = setTimeout(() => void load(), 250);
    return () => {
      clearTimeout(timer);
      revision.current++;
    };
  }, [load]);
  return (
    <section className="issue-picker" aria-label="Connected work">
      <div className="issue-picker-controls">
        <Select aria-label="Issue service" value={provider} onValueChange={setProvider}>
          <SelectItem value="github">GitHub</SelectItem>
          <SelectItem value="linear">Linear</SelectItem>
          <SelectItem value="jira">Jira</SelectItem>
        </Select>
        {provider === 'github' && (
          <Select aria-label="Work type" value={kind} onValueChange={setKind}>
            <SelectItem value="issue">Issues</SelectItem>
            <SelectItem value="pr">Pull requests</SelectItem>
          </Select>
        )}
        <Input
          aria-label="Search issues"
          placeholder="Search issues…"
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="issue-picker-mine">
          <Checkbox checked={mine} onChange={(event) => setMine(event.target.checked)} />
          Assigned to me
        </label>
      </div>
      {error && (
        <InlineNotice
          tone="error"
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void load()}>
                Retry
              </Button>
              {provider !== 'github' && (
                <Button variant="outline" onClick={() => openSettings('Connected work')}>
                  Connection settings
                </Button>
              )}
            </div>
          }
        >
          {error}
        </InlineNotice>
      )}
      <div className="issue-picker-body">
        <fieldset className="issue-picker-list" aria-label="Issues" aria-busy={busy}>
          {items.map((issue) => (
            <button
              type="button"
              key={issue.url}
              aria-pressed={selected?.url === issue.url}
              onClick={() => setSelected(issue)}
            >
              <span>{issue.title}</span>
              <small>
                {issue.id} · {issue.state}
              </small>
            </button>
          ))}
          {!items.length && !busy && !error && (
            <p className="task-muted">No matching issues.{mine ? ' Try all assignees.' : ''}</p>
          )}
          {busy && (
            <p className="task-muted" role="status">
              Loading issues…
            </p>
          )}
          {next && (
            <Button variant="outline" disabled={busy} onClick={() => void load(next)}>
              Load more
            </Button>
          )}
        </fieldset>
        {selected && (
          <article className="issue-picker-detail">
            <h3>{selected.title}</h3>
            <div className="issue-picker-actions">
              <Button
                onClick={() => {
                  try {
                    onDraft(issuePrompt(selected));
                  } catch (cause) {
                    setError(String(cause));
                  }
                }}
              >
                Use this {selected.kind === 'pr' ? 'pull request' : 'issue'}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await openExternalUrl(issueUrl(selected.url));
                  } catch (cause) {
                    setError(String(cause));
                  }
                }}
              >
                Open original
              </Button>
            </div>
            <p className="whitespace-pre-wrap">{selected.body || 'No description.'}</p>
            {selected.truncated && (
              <p className="task-muted">
                Showing an excerpt. Open the original for the full issue.
              </p>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
