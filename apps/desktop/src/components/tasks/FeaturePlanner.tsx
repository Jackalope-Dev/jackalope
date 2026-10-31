import { Checkbox, Input, Textarea } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { featureDraftKey } from '../../lib/feature-draft';
import { manualPlan, planCommands } from '../../lib/plan-mode';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { usePlanStore } from '../../stores/planStore';
import {
  agentAccountFor,
  isAgentAllowedForProject,
  type Project,
  useProjectStore,
} from '../../stores/projectStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';
import { OutcomeEditor } from './OutcomeEditor';

/** The most tasks a plan holds. */
const MAX_TASKS = 8;

interface Step {
  key: string;
  title: string;
  prompt: string;
  scopes: string[];
  dependsOn: string[];
  contextSelection?: { outcomes?: string[] };
}

/**
 * A plan being written. Drafts saved by the earlier feature planner have the
 * same goal, agent and steps and still load; their other fields are ignored.
 */
interface Draft {
  goal: string;
  agent: string;
  steps: Step[];
}

function savedDraft(key: string): Draft | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (
      raw &&
      typeof raw.goal === 'string' &&
      typeof raw.agent === 'string' &&
      Array.isArray(raw.steps) &&
      !raw.added
    )
      return {
        goal: raw.goal,
        agent: raw.agent,
        steps: raw.steps
          .filter((step: unknown) => step && typeof step === 'object')
          .map((step: Partial<Step>) => ({
            key: typeof step.key === 'string' ? step.key : crypto.randomUUID(),
            title: typeof step.title === 'string' ? step.title : '',
            prompt: typeof step.prompt === 'string' ? step.prompt : '',
            scopes: Array.isArray(step.scopes) ? step.scopes : ['.'],
            dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
            contextSelection: { outcomes: step.contextSelection?.outcomes ?? [] },
          })),
      };
  } catch {
    /* Keep an unreadable draft until the user saves a replacement. */
  }
  return null;
}

const emptyStep = (): Step => ({
  key: crypto.randomUUID(),
  title: '',
  prompt: '',
  scopes: ['.'],
  dependsOn: [],
  contextSelection: { outcomes: [] },
});

/** "Write the plan myself": tasks and outcomes become a plan to review, approve and track. */
export function FeaturePlanner({
  project,
  onClose,
  onCreated,
  initialGoal = '',
}: {
  project: Project;
  initialGoal?: string;
  onClose: () => void;
  /** Called once the plan is saved, before the Plans page opens. */
  onCreated?: () => void;
}) {
  const focus = useDialogFocus();
  const runners = useExecutionStore((s) => s.runners);
  const config = useAgentConfigStore(useShallow((s) => ({ isAgentEnabled: s.isAgentEnabled })));
  const available = runners.filter(
    (r) => r.available && config.isAgentEnabled(r.id) && isAgentAllowedForProject(project, r.id),
  );
  const [storageKey] = useState(() => featureDraftKey(localStorage, project.id));
  const [draft, setDraft] = useState<Draft>(
    () =>
      savedDraft(storageKey) ?? {
        goal: initialGoal,
        agent: project.preferences?.preferredRunner || 'auto',
        steps: [emptyStep()],
      },
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setError(
        'The draft could not be saved on this device. Keep this dialog open or copy its contents.',
      );
    }
  };
  const change = (index: number, patch: Partial<Step>) =>
    update({ steps: draft.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const agentReady = draft.agent === 'auto' || available.some((r) => r.id === draft.agent);
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const plan = await planCommands.create(
        {
          id: crypto.randomUUID(),
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          agent: draft.agent,
          agentProfileId:
            draft.agent === 'auto' ? undefined : agentAccountFor(project, draft.agent),
          targetBranch: project.preferences?.baseBranch || project.gitBranch,
          prompt: draft.goal.trim(),
          isolated: true,
        },
        manualPlan(draft.goal, draft.steps),
      );
      localStorage.removeItem(storageKey);
      useProjectStore.getState().selectProject(project.id);
      usePlanStore.getState().select(plan.id);
      onCreated?.();
      onClose();
      navigateWorkspace('plans');
    } catch (cause) {
      setError(String(cause));
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
      <DialogContent {...focus} className="feature-planner">
        <DialogCloseButton disabled={busy} label="Close plan" />
        <DialogHeader
          title="Write the plan myself"
          description="List the tasks and what each must achieve. You review and approve the plan before any work starts, and Jackalope tracks it like any plan."
        />
        <fieldset disabled={busy} className="space-y-3 mt-5">
          <div>
            <label className="task-label block mb-1.5" htmlFor="feature-goal">
              What should this plan accomplish?
            </label>
            <Textarea
              id="feature-goal"
              className="task-input w-full"
              rows={4}
              maxLength={12000}
              value={draft.goal}
              onChange={(e) => update({ goal: e.target.value })}
            />
          </div>
          <div>
            <label className="task-label block mb-1.5" htmlFor="feature-agent">
              Assistant
            </label>
            <Select
              id="feature-agent"
              value={draft.agent}
              onValueChange={(agent) => update({ agent })}
            >
              <SelectItem value="auto">Let Jackalope choose</SelectItem>
              {available.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </Select>
          </div>
        </fieldset>
        <fieldset disabled={busy} className="space-y-5 mt-5">
          {draft.steps.map((step, index) => (
            <article
              key={step.key}
              className="border-t border-[var(--color-border)] pt-4 space-y-3"
            >
              <div>
                <label className="task-label block mb-1.5" htmlFor={`feature-title-${step.key}`}>
                  Task {index + 1}
                </label>
                <Input
                  id={`feature-title-${step.key}`}
                  className="task-input w-full"
                  maxLength={160}
                  value={step.title}
                  onChange={(e) => change(index, { title: e.target.value })}
                />
              </div>
              <div>
                <label
                  className="task-label block mb-1.5"
                  htmlFor={`feature-instruction-${step.key}`}
                >
                  Instructions
                </label>
                <Textarea
                  id={`feature-instruction-${step.key}`}
                  className="task-input w-full"
                  rows={3}
                  maxLength={4000}
                  value={step.prompt}
                  onChange={(e) => change(index, { prompt: e.target.value })}
                />
              </div>
              <div>
                <label className="task-label block mb-1.5" htmlFor={`feature-scopes-${step.key}`}>
                  Files or folders (comma separated)
                </label>
                <Input
                  id={`feature-scopes-${step.key}`}
                  className="task-input w-full"
                  value={step.scopes.join(', ')}
                  onChange={(e) =>
                    change(index, { scopes: e.target.value.split(',').map((s) => s.trim()) })
                  }
                />
              </div>
              {index > 0 && (
                <fieldset>
                  <legend>Starts after</legend>
                  {draft.steps.slice(0, index).map((other) => (
                    <label key={other.key} className="flex gap-3 min-h-11 items-center">
                      <Checkbox
                        checked={step.dependsOn.includes(other.key)}
                        onChange={(e) =>
                          change(index, {
                            dependsOn: e.target.checked
                              ? [...step.dependsOn, other.key]
                              : step.dependsOn.filter((id) => id !== other.key),
                          })
                        }
                      />
                      {other.title || 'Untitled task'}
                    </label>
                  ))}
                </fieldset>
              )}
              <OutcomeEditor
                values={step.contextSelection?.outcomes ?? []}
                onChange={(outcomes) =>
                  change(index, { contextSelection: { ...step.contextSelection, outcomes } })
                }
              />
              {draft.steps.length > 1 && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    update({
                      steps: draft.steps
                        .filter((s) => s.key !== step.key)
                        .map((s) => ({
                          ...s,
                          dependsOn: s.dependsOn.filter((id) => id !== step.key),
                        })),
                    })
                  }
                >
                  Remove task
                </Button>
              )}
            </article>
          ))}
          <Button
            variant="outline"
            disabled={draft.steps.length >= MAX_TASKS}
            onClick={() => update({ steps: [...draft.steps, emptyStep()] })}
          >
            Add a task
          </Button>
        </fieldset>
        {error && (
          <InlineNotice tone="error" className="my-3">
            {error}
          </InlineNotice>
        )}
        <div className="mt-5 space-y-3">
          <p className="task-muted">
            Outcomes become the plan's acceptance criteria. Nothing runs until you approve the plan.
          </p>
          <Button
            disabled={
              busy ||
              !agentReady ||
              !draft.goal.trim() ||
              !draft.steps.length ||
              draft.steps.some((step) => !step.title.trim())
            }
            onClick={() => void create()}
            loading={busy}
            loadingLabel="Saving…"
          >
            Review the plan
          </Button>
        </div>
      </DialogContent>
    </Dialog.Root>
  );
}
