import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { builtinAgents } from '../../lib/agent-catalog';
import type { QueueItem } from '../../lib/queue';
import { queueCommand } from '../../lib/queue';
import { useExecutionStore } from '../../stores/executionStore';
import type { Project } from '../../stores/projectStore';
import { TaskKnowledge } from '../knowledge/TaskKnowledge';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';
import { OutcomeEditor } from './OutcomeEditor';
export function AddWork({
  project,
  items,
  enabled,
  onAdded,
  onClose,
}: {
  enabled: boolean;
  project: Project;
  items: QueueItem[];
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  const dialogFocus = useDialogFocus();
  const { runners } = useExecutionStore();
  const key = `jackalope-plan-draft:${project.id}`;
  const [draft, setDraft] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(key) || 'null') ?? {
          title: '',
          prompt: '',
          agent: 'auto',
          scopes: '',
          dependencies: [],
        }
      );
    } catch {
      return { title: '', prompt: '', agent: 'auto', scopes: '', dependencies: [] };
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (value: Partial<typeof draft>) => {
    const next = { ...draft, ...value };
    setDraft(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await queueCommand('queue_add', {
        request: {
          ...draft,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          targetBranch: project.preferences?.baseBranch || project.gitBranch,
          verifyCommand: project.preferences?.verifyCommand,
          prepareCommand: project.preferences?.prepareCommand,
          autoVerify: project.preferences?.autoVerify === true,
          agentProfileId: project.preferences?.agentAccounts?.[draft.agent],
          scopes: draft.scopes
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean),
        },
      });
      update({ title: '', prompt: '', scopes: '', dependencies: [], contextSelection: undefined });
      await onAdded();
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content {...dialogFocus} className="task-dialog queue-dialog appearance-panel">
          <Dialog.Title className="task-title">A clear piece of work</Dialog.Title>
          <Dialog.Description className="task-muted mt-3">
            Give one agent a focused scope. Add dependencies when it needs another task’s changes
            first. {enabled && 'Dispatch is on: this task may start as soon as you add it.'}
          </Dialog.Description>
          <Dialog.Close className="task-close" aria-label="Close task editor" disabled={busy}>
            <X size={18} />
          </Dialog.Close>
          <form
            className="queue-form"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <label>
              Task title
              <input
                className="task-input"
                value={draft.title}
                maxLength={160}
                required
                onChange={(e) => update({ title: e.target.value })}
                placeholder="Make interrupted work recoverable"
              />
            </label>
            <label>
              What should be delivered?
              <textarea
                className="task-input"
                rows={4}
                required
                value={draft.prompt}
                onChange={(e) => update({ prompt: e.target.value })}
                placeholder="Describe the outcome, constraints, and how to verify it."
              />
            </label>
            <div className="queue-form-pair">
              <label htmlFor="projectqueue-field-1">
                Agent
                <Select
                  id="projectqueue-field-1"
                  aria-label="Agent"
                  className="task-input"
                  value={draft.agent}
                  onValueChange={(value) => update({ agent: value })}
                >
                  <SelectItem value="auto">Let Jackalope choose</SelectItem>
                  {builtinAgents.map(({ id, name }) => (
                    <SelectItem key={id} value={id}>
                      {name}
                      {runners.find((r) => r.id === id)?.available ? '' : ' · not detected'}
                    </SelectItem>
                  ))}
                </Select>
              </label>
              <label>
                Owned files or folders
                <input
                  className="task-input"
                  required
                  value={draft.scopes}
                  onChange={(e) => update({ scopes: e.target.value })}
                  placeholder="src/recovery, docs/recovery.md"
                />
              </label>
            </div>
            <p className="task-muted text-xs">
              Separate paths with commas. Shared scopes wait for integration. Scope is an agent
              instruction, not a filesystem sandbox.
            </p>
            <OutcomeEditor
              values={draft.contextSelection?.outcomes ?? []}
              onChange={(outcomes) =>
                update({ contextSelection: { ...draft.contextSelection, outcomes } })
              }
            />
            <TaskKnowledge
              projectId={project.id}
              projectPath={project.path}
              prompt={draft.prompt}
              selection={draft.contextSelection}
              onChange={(contextSelection) => update({ contextSelection })}
            />
            {items.some((i) => !i.canceled) && (
              <fieldset>
                <legend className="task-label mb-2">Wait for these tasks to merge</legend>
                <div className="queue-dependencies">
                  {items
                    .filter((i) => !i.canceled)
                    .map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={draft.dependencies.includes(item.id)}
                          onChange={(e) =>
                            update({
                              dependencies: e.target.checked
                                ? [...draft.dependencies, item.id]
                                : draft.dependencies.filter((id: string) => id !== item.id),
                            })
                          }
                        />
                        {item.title}
                      </label>
                    ))}
                </div>
              </fieldset>
            )}
            {error && (
              <p className="task-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add to plan'}
              <Plus size={15} />
            </Button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
