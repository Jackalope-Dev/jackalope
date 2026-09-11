import { BookOpen, Lightbulb, Search, Workflow } from 'lucide-react';
import { useRef, useState } from 'react';
import { type KnowledgeEntry, openKnowledgeTask, useKnowledge } from '../../lib/knowledge';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { LoadingState } from '../ui/LoadingState';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { KnowledgeEditor, newKnowledge } from './KnowledgeEditor';

export function KnowledgeLibrary({ project }: { project: Project }) {
  const { entries, error, loading, refresh } = useKnowledge(project.id, project.path);
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [actionError, setActionError] = useState('');
  const openSource = (runId: string) => {
    setActionError('');
    void openKnowledgeTask(project.id, runId).catch((cause) => setActionError(String(cause)));
  };
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<
    { runId: string; agent: string; date: string; excerpt: string }[] | null
  >(null);
  const desktop = isTauriEnvironment();
  const runs = useExecutionStore((s) => s.runs);
  const importer = useRef<HTMLInputElement>(null);
  return (
    <section className="workspace-section workspace-stack" aria-label="Saved project knowledge">
      <WorkspaceSectionHeading
        title="Lessons and workflows"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!desktop} onClick={() => importer.current?.click()}>
              Import workflow
            </Button>
            <input
              ref={importer}
              type="file"
              className="hidden"
              accept=".md,text/markdown,text/plain"
              aria-label="Import workflow Markdown"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setActionError('');
                try {
                  if (file.size > 6000)
                    throw new Error('Choose a concise Markdown workflow up to 6,000 bytes.');
                  const entry = newKnowledge(project, 'workflow');
                  entry.content = await file.text();
                  entry.title = file.name.replace(/\.md$/i, '').slice(0, 100);
                  setEditing(entry);
                } catch (cause) {
                  setActionError(String(cause));
                }
              }}
            />
            <Button
              variant="outline"
              disabled={!desktop}
              onClick={() => setEditing(newKnowledge(project, 'memory'))}
            >
              Add lesson
            </Button>
            <Button
              variant="outline"
              disabled={!desktop}
              onClick={() => setEditing(newKnowledge(project, 'workflow'))}
            >
              Add workflow
            </Button>
          </div>
        }
      />

      {!desktop && <InlineNotice>Open the desktop app to manage saved knowledge.</InlineNotice>}
      {loading && <LoadingState label={'Loading saved knowledge…'} />}
      {(error || actionError) && (
        <InlineNotice tone="error">
          {error || actionError}
          <Button variant="ghost" onClick={() => void refresh()}>
            Reload
          </Button>
        </InlineNotice>
      )}
      {desktop && !loading && !error && !entries.length && (
        <div className="context-knowledge-empty">
          <BookOpen size={28} aria-hidden="true" />
          <div>
            <h3>Make good decisions reusable</h3>
            <p>Save a lesson or add a workflow for future tasks.</p>
          </div>
        </div>
      )}
      <div className="context-knowledge-grid">
        {entries.map((entry) => (
          <article key={entry.id} className="context-knowledge-card">
            <div className="context-knowledge-type">
              {entry.kind === 'memory' ? (
                <Lightbulb size={18} aria-hidden="true" />
              ) : (
                <Workflow size={18} aria-hidden="true" />
              )}
              {entry.automatic
                ? 'Automatically learned'
                : entry.kind === 'memory'
                  ? 'Lesson'
                  : 'Workflow'}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">{entry.title}</h3>
                <p className="task-muted">
                  {entry.enabled ? 'Available' : 'Paused'} · Revision {entry.revision}
                  {runs.some((run) =>
                    run.contextReceipt?.entries.some((e) => e.id === entry.id),
                  ) && (
                    <>
                      {' '}
                      · Used in{' '}
                      {
                        new Set(
                          runs
                            .filter((run) =>
                              run.contextReceipt?.entries.some((e) => e.id === entry.id),
                            )
                            .map((run) => run.taskId),
                        ).size
                      }{' '}
                      tasks
                    </>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(entry)}>
                  Edit
                </Button>
                <ConfirmAction
                  title="Remove saved knowledge?"
                  description="Future tasks will stop using it. Existing task context and source history are kept."
                  onConfirm={async () => {
                    try {
                      await nativeTask('knowledge_remove', {
                        id: entry.id,
                        revision: entry.revision,
                      });
                      await refresh();
                    } catch (e) {
                      setActionError(String(e));
                    }
                  }}
                  trigger={<Button variant="ghost">Remove</Button>}
                />
              </div>
            </div>
            <div className="mt-2">
              <div className="context-knowledge-content">
                <p
                  className={`whitespace-pre-wrap break-words ${expanded[entry.id] ? '' : 'context-knowledge-preview'}`}
                >
                  {entry.content}
                </p>
                <Button
                  variant="ghost"
                  aria-expanded={!!expanded[entry.id]}
                  onClick={() =>
                    setExpanded((current) => ({ ...current, [entry.id]: !current[entry.id] }))
                  }
                >
                  {expanded[entry.id] ? 'Show less' : 'Read full content'}
                </Button>
              </div>
              {entry.keywords.length > 0 && (
                <p className="task-muted mt-2">Matches: {entry.keywords.join(', ')}</p>
              )}
            </div>
            {entry.automatic && (
              <div className="task-muted break-words">
                <p>
                  {entry.automatic.managed ? 'Updated from local evidence' : 'Edited by you'} ·{' '}
                  {entry.automatic.kind}
                </p>
                {entry.automatic.evidence.map((evidence) => (
                  <p key={evidence}>{evidence}</p>
                ))}
              </div>
            )}
            {entry.sourceRunId && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (entry.sourceRunId) openSource(entry.sourceRunId);
                }}
              >
                Open source task
              </Button>
            )}
            {entry.kind === 'workflow' && (
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(entry.content);
                    setActionError('');
                  } catch (cause) {
                    setActionError(`Could not copy workflow: ${String(cause)}`);
                  }
                }}
              >
                Copy Markdown
              </Button>
            )}
          </article>
        ))}
      </div>
      <section className="context-history-search" aria-label="Search past decisions">
        <h3 className="text-base font-medium">Find a decision in past tasks</h3>
        <form
          className="flex gap-2 my-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setSearching(true);
            setActionError('');
            try {
              setMatches(await nativeTask('knowledge_search', { projectId: project.id, query }));
            } catch (cause) {
              setActionError(String(cause));
            } finally {
              setSearching(false);
            }
          }}
        >
          <div className="context-history-field">
            <Search size={16} aria-hidden="true" />
            <Input
              aria-label="Search this project's task history"
              value={query}
              maxLength={200}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search instructions and results…"
            />
          </div>
          <Button disabled={!desktop || searching || query.trim().length < 2}>
            {searching ? 'Searching…' : 'Search'}
          </Button>
        </form>

        {matches?.map((match) => (
          <div key={match.runId} className="py-3">
            <p className="whitespace-pre-wrap break-words">{match.excerpt}</p>
            <Button variant="ghost" onClick={() => openSource(match.runId)}>
              Open task · {match.agent} · {new Date(match.date).toLocaleDateString()}
            </Button>
          </div>
        ))}
        {matches?.length === 0 && <p role="status">No matching tasks.</p>}
      </section>
      {editing && (
        <KnowledgeEditor
          key={editing.id}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}
