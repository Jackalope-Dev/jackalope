import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  Checkbox,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  FieldCheck,
  FormField,
  Input,
  Textarea,
  useDialogFocus,
} from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import type { KnowledgeEntry } from '../../lib/knowledge-types';
import { invokeNative } from '../../lib/native/transport';
import { OutcomeEditor } from '../tasks/OutcomeEditor';
import { ActionError } from '../ui/ActionError';
import './knowledge-editor.css';

export function KnowledgeEditor({
  entry,
  onClose,
  onSaved,
}: {
  entry: KnowledgeEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(entry);
  const [phrases, setPhrases] = useState(entry.keywords.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const focus = useDialogFocus();
  const memory = value.kind === 'memory';
  const limit = memory ? 800 : 6000;
  const bytes = new TextEncoder().encode(value.content).length;
  const keywords = phrases
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const process = value.process ?? { inputs: [], steps: [], outcomes: [] };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent {...focus} className={memory ? 'knowledge-editor' : 'knowledge-editor wide'}>
        <DialogCloseButton disabled={busy} label="Close editor" />
        <DialogHeader
          title={memory ? 'Save a project lesson' : 'Save a reusable workflow'}
          description={`${
            memory
              ? 'Keep one useful fact or decision. Matching future tasks can use it with any agent.'
              : 'Describe the repeatable procedure, required tools, and checks. Apply it to a new task when needed.'
          } Saved locally; no model call is made.`}
        />
        <form
          className="knowledge-editor-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              await invokeNative('knowledge_save', { entry: { ...value, keywords } });
              onSaved();
            } catch (cause) {
              setError(describeError(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          <FormField label="Title">
            <Input
              id="knowledge-title"
              required
              maxLength={120}
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
            />
          </FormField>
          <div className="knowledge-editor-content">
            <FormField label={memory ? 'Lesson' : 'Procedure'}>
              <Textarea
                id="knowledge-content"
                required
                aria-describedby="knowledge-content-size"
                rows={memory ? 4 : 6}
                maxLength={limit}
                value={value.content}
                onChange={(e) => setValue({ ...value, content: e.target.value })}
              />
            </FormField>
            <FieldCheck id="knowledge-content-size" tone={bytes > limit ? 'error' : 'info'}>
              {bytes.toLocaleString()} of {limit.toLocaleString()} bytes.{' '}
              {memory
                ? 'Keep it concise; at most three matching lessons are included per task.'
                : 'Only included when you select this workflow.'}
            </FieldCheck>
          </div>
          {!memory && (
            <section className="knowledge-process" aria-label="Workflow process">
              <ol className="knowledge-process-flow" aria-label="How the workflow runs">
                <li>
                  <strong>{process.inputs.length}</strong> inputs
                </li>
                <ArrowRight size={14} aria-hidden="true" />
                <li>
                  <strong>{process.steps.length}</strong> steps, each reviewed
                </li>
                <ArrowRight size={14} aria-hidden="true" />
                <li>
                  <strong>{process.outcomes.length}</strong> outcomes
                </li>
              </ol>
              <div className="knowledge-process-lists">
                <OutcomeEditor
                  label="Required inputs"
                  values={value.process?.inputs ?? []}
                  onChange={(inputs) =>
                    setValue({
                      ...value,
                      process: { outcomes: [], steps: [], ...value.process, inputs },
                    })
                  }
                />
                <OutcomeEditor
                  label="Process steps, with approval before advancing"
                  values={value.process?.steps ?? []}
                  onChange={(steps) =>
                    setValue({
                      ...value,
                      process: { outcomes: [], inputs: [], ...value.process, steps },
                    })
                  }
                />
                <OutcomeEditor
                  label="Expected outcomes"
                  values={value.process?.outcomes ?? []}
                  onChange={(outcomes) =>
                    setValue({
                      ...value,
                      process: { inputs: [], steps: [], ...value.process, outcomes },
                    })
                  }
                />
              </div>
              <p className="task-muted">
                Inputs are required before launch. Each step runs separately and pauses for your
                evidence review before the next step. Final outcomes require review before
                completion or integration.
              </p>
            </section>
          )}
          {memory && (
            <div className="knowledge-editor-content">
              <FormField
                label="Use when a task mentions"
                description="Comma-separated words or phrases. Matches ignore case and punctuation."
              >
                <Input
                  id="knowledge-phrases"
                  required
                  value={phrases}
                  onChange={(e) => setPhrases(e.target.value)}
                  placeholder="release, installer, Windows upgrade"
                />
              </FormField>
              {keywords.length > 0 && (
                <ul className="knowledge-phrases" aria-label="Matching phrases">
                  {keywords.map((keyword) => (
                    <li key={keyword}>{keyword}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <label className="knowledge-editor-enabled">
            <Checkbox
              checked={value.enabled}
              onChange={(e) => setValue({ ...value, enabled: e.target.checked })}
            />
            Available for future tasks
          </label>
          <ActionError error={error} />
          <Button
            type="submit"
            disabled={busy || bytes > limit}
            loading={busy}
            loadingLabel="Saving…"
          >
            {memory ? 'Save lesson' : 'Save workflow'}
          </Button>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}

export function newKnowledge(
  project: { id: string; path: string },
  kind: KnowledgeEntry['kind'],
  sourceRunId: string | null = null,
): KnowledgeEntry {
  return {
    id: crypto.randomUUID(),
    projectId: project.id,
    projectPath: project.path,
    kind,
    title: '',
    content: '',
    keywords: [],
    enabled: true,
    sourceRunId,
    revision: 0,
    updatedAt: '',
  };
}
