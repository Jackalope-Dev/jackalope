import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { KnowledgeEntry } from '../../lib/knowledge';
import { nativeTask } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useDialogFocus } from '../ui/useDialogFocus';

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
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content {...focus} className="task-dialog appearance-panel">
          <Dialog.Close className="task-close" disabled={busy} aria-label="Close editor">
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-xl">
            {memory ? 'Save a project lesson' : 'Save a reusable workflow'}
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-3">
            {memory
              ? 'Keep one useful fact or decision. Matching future tasks can use it with any agent.'
              : 'Describe the repeatable procedure, required tools, and checks. Apply it to a new task when needed.'}{' '}
            Saved locally; no model call is made.
          </Dialog.Description>
          <form
            className="space-y-4 mt-5"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                await nativeTask('knowledge_save', {
                  entry: {
                    ...value,
                    keywords: phrases
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                });
                onSaved();
              } catch (cause) {
                setError(String(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block" htmlFor="knowledge-title">
              Title
              <Input
                id="knowledge-title"
                required
                maxLength={120}
                value={value.title}
                onChange={(e) => setValue({ ...value, title: e.target.value })}
              />
            </label>
            <label className="block" htmlFor="knowledge-content">
              {memory ? 'Lesson' : 'Procedure'}
              <textarea
                id="knowledge-content"
                required
                className="task-input w-full"
                rows={memory ? 4 : 8}
                maxLength={limit}
                value={value.content}
                onChange={(e) => setValue({ ...value, content: e.target.value })}
              />
            </label>
            <p className="task-muted">
              {bytes.toLocaleString()} / {limit.toLocaleString()} bytes.{' '}
              {memory
                ? 'Keep it concise; at most three matching lessons are included per task.'
                : 'Only included when you select this workflow.'}
            </p>
            {memory && (
              <label className="block" htmlFor="knowledge-phrases">
                Use when a task mentions
                <Input
                  id="knowledge-phrases"
                  required
                  value={phrases}
                  onChange={(e) => setPhrases(e.target.value)}
                  placeholder="release, installer, Windows upgrade"
                />
                <span className="task-muted">
                  Comma-separated words or phrases. Matches ignore case and punctuation.
                </span>
              </label>
            )}
            <label className="flex items-center gap-3 min-h-11">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(e) => setValue({ ...value, enabled: e.target.checked })}
              />
              Available for future tasks
            </label>
            {error && (
              <p role="alert" className="task-error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy || bytes > limit}>
              {busy ? 'Saving…' : memory ? 'Save lesson' : 'Save workflow'}
            </Button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
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
