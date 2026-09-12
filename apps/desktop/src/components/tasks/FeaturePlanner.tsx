import { Checkbox, Input, Textarea } from '@jackalope/ui';
import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { featureDraftKey } from '../../lib/feature-draft';
import { type FeatureStep, featurePlanningPrompt, readFeaturePlan } from '../../lib/feature-plan';
import { queueCommand } from '../../lib/queue';
import { multiAgentPlanningPrompt } from '../../lib/task-decomposition';
import { isActive, nativeTask, type TaskRun } from '../../lib/task-runtime';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useExecutionStore } from '../../stores/executionStore';
import { agentAccountFor, isAgentAllowedForProject, type Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { DialogCloseButton, DialogContent, DialogHeader } from '../ui/Dialog';
import { InlineNotice } from '../ui/InlineNotice';
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
  stagedDependencies?: boolean;
}

export function FeaturePlanner({
  project,
  onClose,
  onAdded,
  initialGoal = '',
  multiAgent = false,
}: {
  project: Project;
  initialGoal?: string;
  multiAgent?: boolean;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const focus = useDialogFocus();
  const { runners, runs, start, submitting } = useExecutionStore();
  const config = useAgentConfigStore();
  const available = runners.filter(
    (r) => r.available && config.isAgentEnabled(r.id) && isAgentAllowedForProject(project, r.id),
  );
  const [storageKey] = useState(() => featureDraftKey(localStorage, project.id, multiAgent));
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
      goal: initialGoal,
      agent: 'auto',
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
  const autoAssignBestAgents = () => {
    update({ steps: draft.steps.map((step) => ({ ...step, agent: 'auto' })) });
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent {...focus} className="feature-planner">
        <DialogCloseButton disabled={busy} label="Close feature plan" />
        <DialogHeader
          title="Plan a feature"
          description={
            <>
              Plan from the repository and the complete request. Review ownership, outcomes and
              dependencies before dispatch.
            </>
          }
        />
        <fieldset
          disabled={busy || submitting || !!planning || draft.added}
          className="space-y-3 mt-5"
        >
          <div>
            <label className="task-label block mb-1.5" htmlFor="feature-goal">
              What should this feature accomplish?
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
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                !draft.goal.trim() ||
                (draft.agent !== 'auto' && !available.some((r) => r.id === draft.agent))
              }
              onClick={() =>
                void act(async () => {
                  const runId = await start(
                    {
                      projectId: project.id,
                      projectName: project.name,
                      projectPath: project.path,
                      agent: draft.agent,
                      agentProfileId:
                        draft.agent === 'auto' ? undefined : agentAccountFor(project, draft.agent),
                      targetBranch: project.preferences?.baseBranch || project.gitBranch,
                      isolated: true,
                      prompt: multiAgent
                        ? multiAgentPlanningPrompt(draft.goal, available)
                        : featurePlanningPrompt(draft.goal),
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
        {draft.steps.length > 1 && (
          <div className="flex flex-wrap gap-2 justify-end mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || draft.added}
              onClick={autoAssignBestAgents}
            >
              <Sparkles size={14} />
              Use automatic routing
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                busy ||
                draft.added ||
                draft.steps.length >= 12 ||
                draft.steps.some((s) => s.key === 'independent-review')
              }
              onClick={() =>
                update({
                  steps: [
                    ...draft.steps,
                    {
                      key: 'independent-review',
                      title: 'Review and verify the combined feature',
                      agent: 'auto',
                      scopes: ['.'],
                      dependsOn: draft.steps.map((s) => s.key),
                      prompt:
                        'Independently inspect the combined implementation against every requirement in the original request. Verify behavior and meaningful regressions. Treat previous agent reports as unverified claims. Fix confirmed defects within scope, rerun relevant checks, and report remaining limitations with evidence.',
                      contextSelection: {
                        outcomes: [
                          'The combined feature satisfies the original request, with recorded verification and explicit remaining limitations.',
                        ],
                      },
                    },
                  ],
                })
              }
            >
              Add independent review
            </Button>
          </div>
        )}
        <fieldset disabled={busy || draft.added} className="space-y-5 mt-5">
          {draft.steps.map((step, index) => (
            <article
              key={step.key}
              className="border-t border-[var(--color-border)] pt-4 space-y-3"
            >
              <div className="grid sm:grid-cols-2 gap-3">
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
                  <label className="task-label block mb-1.5" htmlFor={`feature-agent-${step.key}`}>
                    Assigned agent
                  </label>
                  <Select
                    id={`feature-agent-${step.key}`}
                    value={step.agent || draft.agent}
                    onValueChange={(agent) => change(index, { agent })}
                  >
                    <SelectItem value="auto">Automatic routing</SelectItem>
                    {available.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
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
                  maxLength={20000}
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
              <fieldset>
                <legend>
                  {draft.stagedDependencies
                    ? 'Starts from these verified snapshots'
                    : 'Starts after these tasks are integrated'}
                </legend>
                {draft.steps
                  .filter((s) => s.key !== step.key)
                  .map((other) => (
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
          <InlineNotice tone="error" className="my-3">
            {error}
          </InlineNotice>
        )}
        <label className="flex items-center gap-2 mt-4 min-h-11">
          <Checkbox
            checked={draft.stagedDependencies ?? false}
            disabled={busy || draft.added}
            onChange={(event) => update({ stagedDependencies: event.target.checked })}
          />
          <span>
            Continue dependencies from verified snapshots before final merge. Requires a saved
            project check. Changed predecessors require a new plan.
          </span>
        </label>
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
                    const items = readFeaturePlan(JSON.stringify(draft.steps), draft.agent).map(
                      (step) => ({
                        ...step,
                        prompt: `${step.prompt}\n\nComplete feature request (shared context; perform only your assigned work):\n${draft.goal}`,
                      }),
                    );
                    localStorage.setItem(storageKey, JSON.stringify(draft));
                    await queueCommand('queue_import', {
                      request: {
                        projectId: project.id,
                        projectName: project.name,
                        projectPath: project.path,
                        featureId: draft.featureId,
                        stagedDependencies: draft.stagedDependencies === true,
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
              loading={busy}
              loadingLabel="Saving…"
            >
              {draft.added ? 'Open saved plan' : 'Add reviewed plan, paused'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog.Root>
  );
}
