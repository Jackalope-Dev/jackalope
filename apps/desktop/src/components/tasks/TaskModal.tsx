import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { planningDraft } from '../../lib/planning';
import { ideaStageLabels } from '../../lib/task-collection';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { type TaskStatus, useTaskStore } from '../../stores/taskStore';
import { PromptRefiner } from '../prompt/PromptRefiner';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';

export function TaskModal({
  taskId,
  isOpen,
  onClose,
  onPrepare,
}: {
  taskId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onPrepare: (id: string) => void;
}) {
  const focus = useDialogFocus();
  const { tasks, addTask, updateTask, deleteTask } = useTaskStore();
  const { projects, activeProjectId } = useProjectStore();
  const runners = useExecutionStore((state) => state.runners);
  const existing = tasks.find((task) => task.id === taskId);
  const projectId = existing?.projectId ?? activeProjectId;
  const project = projects.find((project) => project.id === projectId);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [prompt, setPrompt] = useState(existing?.rawPrompt ?? '');
  const [refined, setRefined] = useState(existing?.refinedPrompt ?? '');
  const [clarifications, setClarifications] = useState(existing?.clarifications);
  const [agent, setAgent] = useState(existing?.assignedAgent ?? 'Unassigned');
  const [refining, setRefining] = useState(false);
  const [status, setStatus] = useState<TaskStatus>(existing?.status ?? 'backlog');
  const valid = !!project && !!title.trim() && !!prompt.trim();
  const save = () => {
    if (!valid || !projectId) return;
    const value = {
      title: title.trim(),
      rawPrompt: prompt.trim(),
      refinedPrompt: refined || undefined,
      assignedAgent: agent,
      clarifications,
      status,
    };
    if (existing) {
      updateTask(existing.id, value);
      if (
        value.rawPrompt !== existing.rawPrompt ||
        value.refinedPrompt !== existing.refinedPrompt ||
        value.assignedAgent !== (existing.assignedAgent ?? 'Unassigned') ||
        value.clarifications !== existing.clarifications
      )
        useExecutionStore.getState().draft(`planning:${existing.id}`, planningDraft(value));
      return existing.id;
    }
    return addTask({ ...value, projectId });
  };
  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content {...focus} className="task-dialog appearance-panel planning-dialog">
          <Dialog.Close className="task-close" aria-label="Close idea">
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-xl font-medium pr-10">
            {existing ? 'Edit idea' : 'New idea'}
          </Dialog.Title>
          <Dialog.Description className="task-muted mt-3">
            {project?.name ?? 'Choose a project'} · Shape the idea, then start when you’re ready.
          </Dialog.Description>
          <form
            className="space-y-5 mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (save()) onClose();
            }}
          >
            {existing?.runId && (
              <p className="task-notice">
                This idea was started, but its execution history is unavailable. Restore task
                history to review its result.
              </p>
            )}
            <label htmlFor="idea-title" className="block space-y-2">
              <span className="block text-sm font-medium">Title</span>
              <Input
                id="idea-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What needs to change?"
                required
                maxLength={160}
              />
            </label>
            <label htmlFor="idea-instructions" className="block space-y-2">
              <span className="block text-sm font-medium">Instructions</span>
              <textarea
                id="idea-instructions"
                className="task-input w-full"
                rows={5}
                value={prompt}
                required
                maxLength={24000}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setRefined('');
                  setClarifications(undefined);
                }}
                placeholder="Describe the outcome, constraints, and how to check the result."
              />
            </label>
            <label htmlFor="idea-preferred-agent" className="block space-y-2">
              <span className="block text-sm font-medium">Preferred agent</span>
              <Select
                id="idea-preferred-agent"
                value={agent}
                onValueChange={setAgent}
                aria-label="Preferred agent"
              >
                <SelectItem value="Unassigned">Choose when preparing the task</SelectItem>
                {agent !== 'Unassigned' && !runners.some((runner) => runner.id === agent) && (
                  <SelectItem value={agent}>{agent} (saved preference)</SelectItem>
                )}
                {runners.map((runner) => (
                  <SelectItem key={runner.id} value={runner.id} disabled={!runner.available}>
                    {runner.name}
                    {runner.available ? '' : ' (unavailable)'}
                  </SelectItem>
                ))}
              </Select>
            </label>
            <label htmlFor="idea-stage" className="block space-y-2">
              <span className="block text-sm font-medium">Planning stage</span>
              <Select
                id="idea-stage"
                aria-label="Planning stage"
                value={status}
                onValueChange={(value) => setStatus(value as TaskStatus)}
              >
                {Object.entries(ideaStageLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
              <span className="block task-muted text-xs">
                A planning note; agent progress updates automatically after you start.
              </span>
            </label>
            <Button
              type="button"
              variant="ghost"
              disabled={!prompt.trim()}
              aria-expanded={refining}
              onClick={() => setRefining(!refining)}
            >
              {refining ? 'Hide guidelines' : 'Add optional guidelines'}
            </Button>
            {refining && (
              <PromptRefiner
                rawPrompt={prompt}
                initialClarifications={clarifications}
                onApplyRefinement={(value, answers) => {
                  setRefined(value);
                  setClarifications(answers);
                  setRefining(false);
                }}
                onCancel={() => setRefining(false)}
              />
            )}
            {refined && (
              <details>
                <summary className="task-summary">Prepared instructions</summary>
                <pre className="task-output">{refined}</pre>
              </details>
            )}
            {existing?.worktreePath && (
              <details>
                <summary className="task-summary">Previously created worktree</summary>
                <p className="task-path">{existing.worktreePath}</p>
                <p className="task-muted">
                  Preparing a task lets you choose its execution location.
                </p>
              </details>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
              {existing ? (
                <ConfirmAction
                  title="Delete this idea?"
                  description="The planning record will be removed. Agent tasks and worktrees are kept."
                  onConfirm={() => {
                    deleteTask(existing.id);
                    onClose();
                  }}
                  trigger={
                    <Button type="button" variant="ghost" aria-label="Delete idea">
                      <Trash2 size={16} />
                    </Button>
                  }
                />
              ) : (
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant={existing ? 'outline' : 'primary'} disabled={!valid}>
                  {existing ? 'Save changes' : 'Save idea'}
                </Button>
                {existing && !existing.runId && (
                  <Button
                    type="button"
                    disabled={!valid}
                    onClick={() => {
                      const id = save();
                      if (id) {
                        onPrepare(id);
                        onClose();
                      }
                    }}
                  >
                    Prepare task <ArrowRight size={16} />
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
