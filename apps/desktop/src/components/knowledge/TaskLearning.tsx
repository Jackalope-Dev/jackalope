import { useState } from 'react';
import type { KnowledgeEntry } from '../../lib/knowledge';
import type { TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { useExecutionStore } from '../../stores/executionStore';
import { Button } from '../ui/button';
import { KnowledgeEditor, newKnowledge } from './KnowledgeEditor';

export function TaskLearning({ run }: { run: TaskRun }) {
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [saved, setSaved] = useState('');
  const context = run.contextReceipt;
  const hasEarlierAttempt = useExecutionStore((s) =>
    s.runs.some(
      (r) =>
        r.taskId === run.taskId &&
        r.id !== run.id &&
        r.startedAt < run.startedAt &&
        (r.contract?.step ?? 0) === (run.contract?.step ?? 0),
    ),
  );
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
        <section>
          <h3 className="text-base font-medium">
            Saved context used · {context.entries.length}{' '}
            {context.entries.length === 1 ? 'entry' : 'entries'}
          </h3>
          <p className="task-muted">{context.bytes.toLocaleString()} bytes · first attempt</p>
          {context.entries.map((entry) => (
            <div key={entry.id} className="py-3">
              <h3 className="font-medium">
                {entry.title} · Revision {entry.revision}
              </h3>
              <p className="whitespace-pre-wrap break-words mt-2">{entry.content}</p>
            </div>
          ))}
        </section>
      )}
      {run.status === 'reviewed' && (
        <>
          <h2 className="text-base font-medium">Save project knowledge</h2>

          <div className="flex flex-wrap gap-2">
            {hasEarlierAttempt && (
              <Button
                variant="outline"
                onClick={() => {
                  const entry = newKnowledge(
                    { id: run.projectId, path: run.projectPath },
                    'memory',
                    run.id,
                  );
                  entry.title = 'Lesson from this correction';
                  if (new TextEncoder().encode(run.prompt).length <= 800)
                    entry.content = run.prompt;
                  setEditing(entry);
                }}
              >
                Turn this correction into a lesson
              </Button>
            )}
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
                entry.process = {
                  inputs: Object.keys(run.contract?.inputs ?? {}),
                  steps: (run.contract?.requirements ?? [])
                    .filter((r) => r.checkpoint)
                    .map((r) => r.title),
                  outcomes: (run.contract?.requirements ?? [])
                    .filter((r) => !r.checkpoint)
                    .map((r) => r.title),
                };
                const procedure =
                  run.contextReceipt?.entries.find((e) => e.kind === 'workflow')?.content ||
                  run.prompt;
                const seed = `${procedure}\n\nVerification\n${run.verifyCommand || 'Describe how to verify the result.'}`;
                if (new TextEncoder().encode(seed).length <= 6000) entry.content = seed;
                setEditing(entry);
              }}
            >
              Use this process again
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
