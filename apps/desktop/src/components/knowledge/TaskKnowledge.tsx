import { useEffect, useState } from 'react';
import { type ContextReceipt, type ContextSelection, useKnowledge } from '../../lib/knowledge';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import './task-knowledge.css';

export function TaskKnowledge({
  projectId,
  projectPath,
  prompt,
  selection = {},
  onChange,
  embedded = false,
}: {
  projectId: string;
  projectPath: string;
  prompt: string;
  selection?: ContextSelection;
  onChange: (value: ContextSelection) => void;
  embedded?: boolean;
}) {
  const { entries, error } = useKnowledge(projectId, projectPath);
  const [receipt, setReceipt] = useState<ContextReceipt | null>(null);
  const [previewError, setPreviewError] = useState('');
  const signature = JSON.stringify(selection);
  useEffect(() => {
    let alive = true;
    setReceipt(null);
    if (!isTauriEnvironment()) return;
    const timer = setTimeout(() => {
      nativeTask<ContextReceipt>('knowledge_preview', {
        projectId,
        projectPath,
        prompt,
        selection: JSON.parse(signature),
      })
        .then((value) => {
          if (alive) {
            setReceipt(value);
            setPreviewError('');
          }
        })
        .catch((cause) => {
          if (alive) setPreviewError(String(cause));
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId, projectPath, prompt, signature]);
  const workflow = entries.find((e) => e.id === selection.workflowId);
  const workflows = entries.filter((e) => e.kind === 'workflow' && e.enabled);
  const Container = embedded ? 'section' : 'details';
  const Heading = embedded ? 'div' : 'summary';
  return (
    <Container className="task-knowledge">
      <Heading className="task-knowledge-heading">
        Saved project context{receipt ? ` · ${receipt.entries.length} included` : ''}
      </Heading>
      <div className="task-knowledge-body">
        <label className="task-knowledge-field" htmlFor="task-workflow">
          <span>Workflow</span>
          <Select
            id="task-workflow"
            aria-label="Workflow"
            value={selection.workflowId || 'none'}
            onValueChange={(id) =>
              onChange({ ...selection, workflowId: id === 'none' ? null : id })
            }
          >
            <SelectItem value="none">No workflow</SelectItem>
            {selection.workflowId && !workflows.some((w) => w.id === selection.workflowId) && (
              <SelectItem value={selection.workflowId}>
                Unavailable workflow — choose another
              </SelectItem>
            )}
            {workflows.map((workflow) => (
              <SelectItem key={workflow.id} value={workflow.id}>
                {workflow.title}
              </SelectItem>
            ))}
          </Select>
        </label>
        {workflow?.process?.inputs.map((name, index) => (
          <label key={name} className="task-knowledge-field" htmlFor={`workflow-input-${index}`}>
            <span>{name}</span>
            <textarea
              id={`workflow-input-${index}`}
              className="task-input w-full"
              rows={2}
              maxLength={2000}
              value={selection.inputValues?.[name] ?? ''}
              onChange={(e) =>
                onChange({
                  ...selection,
                  inputValues: { ...selection.inputValues, [name]: e.target.value },
                })
              }
            />
            <span className="task-muted">Required for this workflow. Do not enter secrets.</span>
          </label>
        ))}
        {!!workflow?.process?.steps.length && (
          <p className="task-muted">Review checkpoints: {workflow.process.steps.join(' → ')}</p>
        )}
        {!!workflow?.process?.outcomes.length && (
          <ul className="list-disc pl-5">
            {workflow.process.outcomes.map((outcome) => (
              <li key={outcome}>{outcome}</li>
            ))}
          </ul>
        )}
        <label className="flex gap-3 items-center min-h-11">
          <input
            type="checkbox"
            checked={!selection.memoryOff}
            onChange={(e) => onChange({ ...selection, memoryOff: !e.target.checked })}
          />
          Use matching project lessons (up to three)
        </label>
        {(error || previewError) && (
          <p role="alert" className="task-error">
            {error || previewError}
          </p>
        )}
        {receipt?.entries.map((entry) => (
          <div key={entry.id} className="py-2">
            <details>
              <summary className="min-h-11 py-3">
                {entry.title} · {entry.kind === 'memory' ? 'Matched lesson' : 'Selected workflow'}
              </summary>
              <p className="whitespace-pre-wrap break-words">{entry.content}</p>
            </details>
            {entry.kind === 'memory' && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...selection,
                    excludedMemoryIds: [...(selection.excludedMemoryIds ?? []), entry.id],
                  })
                }
              >
                Skip for this task
              </Button>
            )}
          </div>
        ))}
        {!!selection.excludedMemoryIds?.length && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange({ ...selection, excludedMemoryIds: [] })}
          >
            Restore skipped lessons
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => navigateWorkspace('project-settings')}>
          Manage project knowledge
        </Button>
      </div>
    </Container>
  );
}
