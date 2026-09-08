import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import { type FeatureStep, featurePlanningPrompt, readFeaturePlan } from '../../lib/feature-plan';
import { queueCommand } from '../../lib/queue';
import { isActive, nativeTask, type TaskRun } from '../../lib/task-runtime';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { agentAccountFor, isAgentAllowedForProject, type Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { useDialogFocus } from '../ui/useDialogFocus';
import { OutcomeEditor } from './OutcomeEditor';

interface Draft {
  featureId: string;
  goal: string;
  agent: string;
  runId?: string;
  steps: FeatureStep[];
  added?: boolean;
}

export function FeaturePlanner({
  project,
  onClose,
  onAdded,
}: {
  project: Project;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const focus = useDialogFocus();
  const { runners, runs, start, submitting } = useExecutionStore();
  const config = useAgentConfigStore();
  const available = runners.filter(
    (r) => r.available && config.isAgentEnabled(r.id) && isAgentAllowedForProject(project, r.id),
  );
  const storageKey = `jackalope-feature-plan:${project.id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      if (
        raw &&
        typeof raw.goal === 'string' &&
        typeof raw.agent === 'string' &&
        Array.isArray(raw.steps)
      )
        return {
          ...raw,
          featureId: typeof raw.featureId === 'string' ? raw.featureId : crypto.randomUUID(),
        };
    } catch {
      /* Keep an unreadable draft until the user saves a replacement. */
    }
    return {
      featureId: crypto.randomUUID(),
      goal: '',
      agent:
        available.find((r) => r.id === project.preferences?.preferredRunner)?.id ??
        available[0]?.id ??
        '',
      steps: [],
    };
  });
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
  const run = runs.find((r) => r.id === draft.runId);
  const planning = run && isActive(run);
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const change = (index: number, patch: Partial<FeatureStep>) =>
    update({ steps: draft.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content {...focus} className="task-dialog appearance-panel feature-planner">
          <Dialog.Close className="task-close" aria-label="Close feature plan" disabled={busy}>
            <X size={18} />
          </Dialog.Close>
          <Dialog.Title className="text-xl">Plan a feature</Dialog.Title>
          <Dialog.Description className="task-muted mt-3">
            Use one assistant from planning through review. Edit the proposed tasks before adding
            them; dependencies wait for integrated changes.
          </Dialog.Description>
          <fieldset
            disabled={busy || submitting || !!planning || draft.added}
            className="space-y-3 mt-5"
          >
            <label className="block" htmlFor="feature-goal">
              What should this feature accomplish?
              <textarea
                id="feature-goal"
                className="task-input w-full"
                rows={4}
                maxLength={12000}
                value={draft.goal}
                onChange={(e) => update({ goal: e.target.value })}
              />
            </label>
            <label className="block" htmlFor="feature-agent">
              Assistant
              <Select
                id="feature-agent"
                value={draft.agent}
                onValueChange={(agent) => update({ agent })}
              >
                {available.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </Select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!draft.goal.trim() || !available.some((r) => r.id === draft.agent)}
                onClick={() =>
                  void act(async () => {
                    const runId = await start(
                      {
                        projectId: project.id,
                        projectName: project.name,
                        projectPath: project.path,
                        agent: draft.agent,
                        agentProfileId: agentAccountFor(project, draft.agent),
                        targetBranch: project.preferences?.baseBranch || project.gitBranch,
                        isolated: true,
                        prompt: featurePlanningPrompt(draft.goal),
                      },
                      { background: true },
                    );
                    update({ runId });
                  })
                }
              >
                Ask for a proposed plan
              </Button>
              <Button
                variant="outline"
                disabled={draft.steps.length >= 12}
                onClick={() =>
                  update({
                    steps: [
                      ...draft.steps,
                      {
                        key: crypto.randomUUID(),
                        title: '',
                        prompt: '',
                        agent: draft.agent,
                        scopes: ['.'],
                        dependsOn: [],
                        contextSelection: { outcomes: [] },
                      },
                    ],
                  })
                }
              >
                Add a task myself
              </Button>
            </div>
          </fieldset>
          {run && (
            <div className="task-notice my-4">
              <p>
                {planning
                  ? 'Planning in an isolated workspace. You can close this dialog; the draft keeps its task link.'
                  : `Planning task: ${run.status}`}
              </p>
              <Button
                variant="ghost"
                onClick={() => {
                  useExecutionStore.getState().select(run.id);
                  onClose();
                }}
              >
                Open planning task
              </Button>
              {!planning && (
                <Button
                  disabled={busy || draft.added}
                  onClick={() =>
                    void act(async () => {
                      const detail = (
                        await nativeTask<TaskRun[]>('task_runs', { detailId: run.id })
                      ).find((r) => r.id === run.id);
                      if (!detail) throw new Error('Planning result is unavailable.');
                      update({ steps: readFeaturePlan(detail.result, draft.agent) });
                    })
                  }
                >
                  Review proposed tasks
                </Button>
              )}
            </div>
          )}
          <fieldset disabled={busy || draft.added} className="space-y-5 mt-5">
            {draft.steps.map((step, index) => (
              <article
                key={step.key}
                className="border-t border-[var(--color-border)] pt-4 space-y-3"
              >
                <label className="block" htmlFor={`feature-title-${step.key}`}>
                  Task {index + 1}
                  <input
                    id={`feature-title-${step.key}`}
                    className="task-input w-full"
                    maxLength={160}
                    value={step.title}
                    onChange={(e) => change(index, { title: e.target.value })}
                  />
                </label>
                <label className="block" htmlFor={`feature-instruction-${step.key}`}>
                  Instructions
                  <textarea
                    id={`feature-instruction-${step.key}`}
                    className="task-input w-full"
                    rows={3}
                    maxLength={20000}
                    value={step.prompt}
                    onChange={(e) => change(index, { prompt: e.target.value })}
                  />
                </label>
                <label className="block" htmlFor={`feature-scopes-${step.key}`}>
                  Files or folders (comma separated)
                  <input
                    id={`feature-scopes-${step.key}`}
                    className="task-input w-full"
                    value={step.scopes.join(', ')}
                    onChange={(e) =>
                      change(index, { scopes: e.target.value.split(',').map((s) => s.trim()) })
                    }
                  />
                </label>
                <fieldset>
                  <legend>Starts after these tasks are integrated</legend>
                  {draft.steps
                    .filter((s) => s.key !== step.key)
                    .map((other) => (
                      <label key={other.key} className="flex gap-3 min-h-11 items-center">
                        <input
                          type="checkbox"
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
                <OutcomeEditor
                  values={step.contextSelection?.outcomes ?? []}
                  onChange={(outcomes) =>
                    change(index, { contextSelection: { ...step.contextSelection, outcomes } })
                  }
                />
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
              </article>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="task-error my-3">
              {error}
            </p>
          )}
          {!!draft.steps.length && (
            <div className="mt-5 space-y-3">
              <p className="task-muted">
                Adding the plan pauses dispatch for this project. Review it in Feature work, then
                choose Run ready tasks.
              </p>
              <Button
                disabled={busy || submitting || !!planning || !draft.agent || !draft.goal.trim()}
                onClick={() =>
                  void act(async () => {
                    if (!draft.added) {
                      const items = readFeaturePlan(JSON.stringify(draft.steps), draft.agent);
                      localStorage.setItem(storageKey, JSON.stringify(draft));
                      await queueCommand('queue_import', {
                        request: {
                          projectId: project.id,
                          projectName: project.name,
                          projectPath: project.path,
                          featureId: draft.featureId,
                          feature: draft.goal.trim().split('\n')[0].slice(0, 120),
                          targetBranch: project.preferences?.baseBranch || project.gitBranch,
                          agentAccounts: project.preferences?.agentAccounts,
                          verifyCommand: project.preferences?.verifyCommand,
                          prepareCommand: project.preferences?.prepareCommand,
                          autoVerify: project.preferences?.autoVerify === true,
                          items,
                        },
                      });
                      update({ added: true });
                    }
                    await onAdded();
                    localStorage.removeItem(storageKey);
                    onClose();
                  })
                }
              >
                {busy ? 'Saving…' : draft.added ? 'Open saved plan' : 'Add reviewed plan, paused'}
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
