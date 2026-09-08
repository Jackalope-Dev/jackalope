import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Layers, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { queueCommand } from '../../lib/queue';
import {
  type DecomposedSubtask,
  generateHeuristicDecomposition,
} from '../../lib/task-decomposition';
import type { Runner } from '../../lib/task-runtime';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { agentAccountFor, isAgentAllowedForProject, type Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';

interface Props {
  open: boolean;
  onClose: () => void;
  goal: string;
  project: Project;
  runners: Runner[];
  onImported?: () => void;
}

export function MultiAgentSplitDialog({
  open,
  onClose,
  goal,
  project,
  runners,
  onImported,
}: Props) {
  const focus = useDialogFocus();
  const config = useAgentConfigStore();
  const availableRunners = runners.filter(
    (r) => r.available && config.isAgentEnabled(r.id) && isAgentAllowedForProject(project, r.id),
  );
  const [subtasks, setSubtasks] = useState<DecomposedSubtask[]>(() =>
    generateHeuristicDecomposition(goal, availableRunners.length ? availableRunners : runners),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const updateSubtask = (index: number, patch: Partial<DecomposedSubtask>) => {
    setSubtasks((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, ...patch };
        if (patch.agent) {
          const runner = runners.find((r) => r.id === patch.agent);
          updated.agentName = runner?.name || patch.agent;
        }
        return updated;
      }),
    );
  };

  const removeSubtask = (index: number) => {
    const targetKey = subtasks[index].key;
    setSubtasks((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((s) => ({
          ...s,
          dependsOn: s.dependsOn.filter((k) => k !== targetKey),
        })),
    );
  };

  const addSubtask = () => {
    const key = `task-${Date.now().toString(36)}`;
    const defaultRunner = availableRunners[0] || runners[0];
    const prevKey = subtasks.length > 0 ? subtasks[subtasks.length - 1].key : undefined;

    setSubtasks((prev) => [
      ...prev,
      {
        key,
        title: 'New Subtask',
        prompt: '',
        agent: defaultRunner?.id || 'codex',
        agentName: defaultRunner?.name || 'Codex',
        scopes: ['.'],
        dependsOn: prevKey ? [prevKey] : [],
        rationale: 'Custom added step',
      },
    ]);
  };

  const launchPlan = async () => {
    if (!subtasks.length) return;
    setBusy(true);
    setError('');

    try {
      const items = subtasks.map((s) => ({
        key: s.key,
        title: s.title.trim() || 'Untitled task',
        prompt: s.prompt.trim() || s.title.trim(),
        agent: s.agent,
        scopes: s.scopes.length ? s.scopes : ['.'],
        dependsOn: s.dependsOn,
      }));

      const agentAccounts: Record<string, string> = {};
      for (const item of items) {
        const account = agentAccountFor(project, item.agent);
        if (account) agentAccounts[item.agent] = account;
      }

      await queueCommand('queue_import', {
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        targetBranch: project.preferences?.baseBranch || project.gitBranch,
        agentAccounts,
        verifyCommand: project.preferences?.verifyCommand,
        prepareCommand: project.preferences?.prepareCommand,
        autoVerify: project.preferences?.autoVerify === true,
        items,
      });

      onImported?.();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(val) => !val && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content
          {...focus}
          className="task-dialog appearance-panel max-w-3xl max-h-[85vh] overflow-y-auto"
        >
          <Dialog.Close className="task-close" aria-label="Close" disabled={busy}>
            <X size={18} />
          </Dialog.Close>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="text-[var(--color-accent)]" size={22} />
            <Dialog.Title className="text-xl font-medium">
              Multi-Agent Task Decomposition
            </Dialog.Title>
          </div>
          <Dialog.Description className="task-muted text-sm">
            We analyzed your goal and automatically split it into sequenced subtasks assigned to the
            best-fit agents detected on your system. Each task runs in its own isolated worktree.
          </Dialog.Description>

          {error && (
            <p role="alert" className="task-error mt-3">
              {error}
            </p>
          )}

          <div className="space-y-4 mt-5">
            {subtasks.map((subtask, index) => (
              <div
                key={subtask.key}
                className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="font-semibold text-xs px-2 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                      Step {index + 1}
                    </span>
                    <input
                      className="task-input flex-1 font-medium text-sm"
                      value={subtask.title}
                      placeholder="Task title"
                      maxLength={140}
                      disabled={busy}
                      onChange={(e) => updateSubtask(index, { title: e.target.value })}
                    />
                  </div>
                  {subtasks.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Remove step ${index + 1}`}
                      onClick={() => removeSubtask(index)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label
                      htmlFor={`subtask-agent-${index}`}
                      className="text-xs task-muted block mb-1"
                    >
                      Assigned Agent
                    </label>
                    <Select
                      id={`subtask-agent-${index}`}
                      value={subtask.agent}
                      disabled={busy}
                      onValueChange={(agent) => updateSubtask(index, { agent })}
                    >
                      {(availableRunners.length ? availableRunners : runners).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label
                      htmlFor={`subtask-scopes-${index}`}
                      className="text-xs task-muted block mb-1"
                    >
                      File Scopes
                    </label>
                    <input
                      id={`subtask-scopes-${index}`}
                      className="task-input text-xs w-full"
                      value={subtask.scopes.join(', ')}
                      disabled={busy}
                      onChange={(e) =>
                        updateSubtask(index, {
                          scopes: e.target.value.split(',').map((s) => s.trim()),
                        })
                      }
                      placeholder="e.g. src/components, ."
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor={`subtask-prompt-${index}`}
                    className="text-xs task-muted block mb-1"
                  >
                    Agent Instructions
                  </label>
                  <textarea
                    id={`subtask-prompt-${index}`}
                    className="task-input text-xs w-full"
                    rows={2}
                    value={subtask.prompt}
                    disabled={busy}
                    onChange={(e) => updateSubtask(index, { prompt: e.target.value })}
                    placeholder="Specific actionable instructions for this agent"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs task-muted">
                  <Bot size={13} />
                  <span>{subtask.rationale}</span>
                  {subtask.dependsOn.length > 0 && (
                    <span className="ml-auto font-mono text-[11px]">
                      Waits for: {subtask.dependsOn.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-5 pt-3 border-t border-[var(--color-border)]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || subtasks.length >= 8}
              onClick={addSubtask}
            >
              <Plus size={14} /> Add subtask
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" disabled={busy || !subtasks.length} onClick={launchPlan}>
                <Layers size={15} />
                {busy ? 'Dispatching to Queue…' : 'Launch Multi-Agent Team'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
