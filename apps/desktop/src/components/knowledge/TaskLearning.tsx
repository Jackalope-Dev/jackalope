import { useState } from 'react';
import type { KnowledgeEntry } from '../../lib/knowledge';
import type { TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { Button } from '../ui/button';
import { KnowledgeEditor, newKnowledge } from './KnowledgeEditor';

export function TaskLearning({ run }: { run: TaskRun }) {
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [saved, setSaved] = useState('');
  const context = run.contextReceipt;
  return (
    <section className="my-5 space-y-3" aria-label="Project knowledge used by this task">
      {run.monitorChange && (
        <p className="task-notice">
          Started after committed changes to {run.monitorChange.path || 'this project'} on{' '}
          {run.monitorChange.branch}. The agent received the before and after content revisions;
          inspect the recorded change in Recurring.
        </p>
      )}
      {!!context?.entries.length && (
        <details>
          <summary className="min-h-11 py-3">
            Saved context used · {context.entries.length}{' '}
            {context.entries.length === 1 ? 'entry' : 'entries'}
          </summary>
          <p className="task-muted">
            {context.bytes.toLocaleString()} bytes supplied at the first attempt. Continuations
            reuse their agent session; this context is not appended again.
          </p>
          {context.entries.map((entry) => (
            <div key={entry.id} className="py-3">
              <h3 className="font-medium">
                {entry.title} · Revision {entry.revision}
              </h3>
              <p className="whitespace-pre-wrap break-words mt-2">{entry.content}</p>
            </div>
          ))}
        </details>
      )}
      {run.status === 'reviewed' && (
        <>
          <h2 className="text-base font-medium">Make the next task easier</h2>
          <p className="task-muted">
            Save a concise lesson or a repeatable procedure for any agent in this project. You
            choose the content; Jackalope keeps this task as its source.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setEditing(
                  newKnowledge({ id: run.projectId, path: run.projectPath }, 'memory', run.id),
                )
              }
            >
              Save lesson
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const entry = newKnowledge(
                  { id: run.projectId, path: run.projectPath },
                  'workflow',
                  run.id,
                );
                entry.title = taskTitle(run.prompt).slice(0, 100);
                const seed = `${run.prompt}\n\nVerification\n${run.verifyCommand || 'Describe how to verify the result.'}`;
                if (new TextEncoder().encode(seed).length <= 6000) entry.content = seed;
                setEditing(entry);
              }}
            >
              Save workflow
            </Button>
          </div>
          {saved && (
            <p role="status" className="task-muted">
              {saved} Manage it in Project → Context.
            </p>
          )}
        </>
      )}
      {editing && (
        <KnowledgeEditor
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setSaved(
              editing.kind === 'memory'
                ? 'Lesson saved for matching future tasks.'
                : 'Workflow saved. Select it when composing your next task.',
            );
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
