import { Badge } from '@jackalope/ui';
import { useEffect, useId, useState } from 'react';
import { useAgentModels } from '../../lib/agent-models';
import { isTauriEnvironment } from '../../lib/native/env';
import {
  type DecideSettings,
  defaultDecideSettings,
  type PlanSettings,
  planCommands,
} from '../../lib/plan-mode';
import { useExecutionStore } from '../../stores/executionStore';
import { Setting, SettingBody, SettingGroup } from '../settings/Setting';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';

const QUESTION_LIMITS = Array.from({ length: 13 }, (_, limit) => limit);
const ROUND_LIMITS = [1, 2, 3, 5, 8, 12, 20];
const ORCHESTRATOR_LIMITS = [1, 2, 3, 4];
const DECISION_LIMITS = [10, 25, 50, 100, 200];
/** What always reaches the person, whatever these settings or a committed policy say. */
const ALWAYS_YOURS = [
  'Signing in, two-factor codes and OAuth approvals',
  'Payment, billing and plan upgrades',
  'Secrets, API keys and passwords',
  'Creating accounts',
  'Publishing, releases, deploys and DNS',
  'Deleting data or rewriting Git history',
  'Protected paths from the autonomy policy, .jackalope and CI configuration',
  "Changes to the plan's goal, scope or architecture",
];
const TASK_AGENT = 'task';
const AGENT_DEFAULT = 'default';

/** Plan mode settings for one project: the interview limit, swarm rounds, planning agent and model, where Save to repo writes, and what agents may decide. */
export function ProjectPlanningSettings({ projectId }: { projectId: string }) {
  const id = useId();
  const runners = useExecutionStore((state) => state.runners);
  const [settings, setSettings] = useState<PlanSettings>();
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let current = true;
    setSettings(undefined);
    setError('');
    void planCommands
      .settings(projectId)
      .then((value) => {
        if (!current) return;
        setSettings(value);
        setPath(value.exportPath);
      })
      .catch((cause) => current && setError(String(cause)));
    return () => {
      current = false;
    };
  }, [projectId]);
  const models = useAgentModels(settings?.plannerAgent ?? '');
  if (!settings)
    return error ? (
      <SettingGroup title="Planning">
        <InlineNotice tone="error">{error}</InlineNotice>
      </SettingGroup>
    ) : null;
  const save = async (next: PlanSettings) => {
    const previous = settings;
    setSettings(next);
    setError('');
    try {
      await planCommands.saveSettings(projectId, next);
    } catch (cause) {
      setSettings(previous);
      setPath(previous.exportPath);
      setError(String(cause));
    }
  };
  const agents = runners.filter((runner) => runner.available);
  const decide: DecideSettings = { ...defaultDecideSettings, ...settings.decide };
  const setDecide = (change: Partial<DecideSettings>) =>
    void save({ ...settings, decide: { ...decide, ...change } });
  return (
    <>
      <SettingGroup
        title="Planning"
        description="Applies to new plans in this project, whether you plan with an agent or write the plan yourself."
      >
        <Setting
          title="Most questions per plan"
          description="The planner asks only what the code cannot answer. With 0 it records its assumptions instead."
          descriptionId={`${id}-cap-description`}
        >
          <Select
            aria-label="Most questions per plan"
            aria-describedby={`${id}-cap-description`}
            value={String(settings.questionCap)}
            onValueChange={(value) => void save({ ...settings, questionCap: Number(value) })}
          >
            {QUESTION_LIMITS.map((limit) => (
              <SelectItem key={limit} value={String(limit)}>
                {limit === 0 ? 'None' : limit === 1 ? '1 question' : `${limit} questions`}
              </SelectItem>
            ))}
          </Select>
        </Setting>
        <Setting
          title={
            <span className="inline-flex items-center gap-2">
              Most swarm rounds <Badge variant="accent">Beta</Badge>
            </span>
          }
          description="A swarm stops for a re-plan when its criteria are still unmet after this many rounds."
          descriptionId={`${id}-rounds-description`}
        >
          <Select
            aria-label="Most swarm rounds"
            aria-describedby={`${id}-rounds-description`}
            value={String(settings.maxRounds ?? 5)}
            onValueChange={(value) => void save({ ...settings, maxRounds: Number(value) })}
          >
            {[...new Set([...ROUND_LIMITS, settings.maxRounds ?? 5])]
              .sort((a, b) => a - b)
              .map((limit) => (
                <SelectItem key={limit} value={String(limit)}>
                  {limit === 1 ? '1 round' : `${limit} rounds`}
                </SelectItem>
              ))}
          </Select>
        </Setting>
        <Setting
          title={
            <span className="inline-flex items-center gap-2">
              Next swarm round <Badge variant="accent">Beta</Badge>
            </span>
          }
          description="After a review names more work, start it or wait for your approval. Each plan can change this."
          descriptionId={`${id}-approval-description`}
        >
          <Select
            aria-label="Next swarm round"
            aria-describedby={`${id}-approval-description`}
            value={settings.askBeforeRounds ? 'ask' : 'auto'}
            onValueChange={(value) => void save({ ...settings, askBeforeRounds: value === 'ask' })}
          >
            <SelectItem value="auto">Start automatically</SelectItem>
            <SelectItem value="ask">Ask me first</SelectItem>
          </Select>
        </Setting>
        <Setting
          title={
            <span className="inline-flex items-center gap-2">
              Swarm orchestrators <Badge variant="accent">Beta</Badge>
            </span>
          }
          description="Large swarms split their review into areas, each checked by its own orchestrator at once."
          descriptionId={`${id}-orchestrators-description`}
        >
          <Select
            aria-label="Swarm orchestrators"
            aria-describedby={`${id}-orchestrators-description`}
            value={String(settings.orchestrators ?? 1)}
            onValueChange={(value) => void save({ ...settings, orchestrators: Number(value) })}
          >
            {ORCHESTRATOR_LIMITS.map((limit) => (
              <SelectItem key={limit} value={String(limit)}>
                {limit === 1 ? '1 orchestrator' : `Up to ${limit}`}
              </SelectItem>
            ))}
          </Select>
        </Setting>
        <Setting
          title="Planning agent"
          description="Plans with this agent instead of the one chosen for the task."
          descriptionId={`${id}-agent-description`}
        >
          <Select
            aria-label="Planning agent"
            aria-describedby={`${id}-agent-description`}
            value={settings.plannerAgent || TASK_AGENT}
            onValueChange={(value) =>
              void save({
                ...settings,
                plannerAgent: value === TASK_AGENT ? null : value,
                // A model belongs to the agent that offers it.
                plannerModel: value === settings.plannerAgent ? settings.plannerModel : null,
              })
            }
          >
            <SelectItem value={TASK_AGENT}>The task's agent</SelectItem>
            {agents.map((runner) => (
              <SelectItem key={runner.id} value={runner.id}>
                {runner.name}
              </SelectItem>
            ))}
          </Select>
        </Setting>
        {settings.plannerAgent && (
          <Setting
            title="Planning model"
            description={
              models.loading
                ? 'Reading available models…'
                : models.error || 'The model the planning agent uses.'
            }
            descriptionId={`${id}-model-description`}
          >
            <Select
              aria-label="Planning model"
              aria-describedby={`${id}-model-description`}
              disabled={models.loading}
              value={settings.plannerModel || AGENT_DEFAULT}
              onValueChange={(value) =>
                void save({ ...settings, plannerModel: value === AGENT_DEFAULT ? null : value })
              }
            >
              <SelectItem value={AGENT_DEFAULT}>Agent default</SelectItem>
              {settings.plannerModel &&
                !models.catalog?.models.some((model) => model.id === settings.plannerModel) && (
                  <SelectItem value={settings.plannerModel}>{settings.plannerModel}</SelectItem>
                )}
              {(models.catalog?.models ?? []).map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </Select>
          </Setting>
        )}
        <Setting
          title="Save to repo path"
          description="Where Save to repo writes a plan, relative to the project. {slug} becomes the plan title. Nothing is committed."
          controlId={`${id}-path`}
          descriptionId={`${id}-path-description`}
        >
          <Input
            id={`${id}-path`}
            aria-describedby={`${id}-path-description`}
            className="project-setting-input"
            value={path}
            maxLength={240}
            placeholder="docs/plans/{slug}.md"
            onChange={(event) => setPath(event.target.value)}
            onBlur={() => {
              const next = path.trim();
              if (next && next !== settings.exportPath)
                void save({ ...settings, exportPath: next });
              else setPath(settings.exportPath);
            }}
          />
        </Setting>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </SettingGroup>
      <SettingGroup
        title="Autonomy"
        description="Let agents decide routine work on approved plans so a long build keeps moving. Every agent decision is shown on the plan with its reason, and you can override it."
      >
        <Setting
          title="Let agents decide routine questions"
          description="Another agent answers questions from plan work that the plan and code settle. When it is unsure, the question comes to you."
          descriptionId={`${id}-questions-description`}
        >
          <Switch
            label="Let agents decide routine questions"
            aria-describedby={`${id}-questions-description`}
            checked={decide.questions}
            onCheckedChange={(questions) => setDecide({ questions })}
          />
        </Setting>
        <Setting
          title="Let agents approve swarm rounds"
          description="With Ask me first, an agent approves the next round once the merged round passed its check."
          descriptionId={`${id}-rounds-auto-description`}
        >
          <Switch
            label="Let agents approve swarm rounds"
            aria-describedby={`${id}-rounds-auto-description`}
            checked={decide.rounds}
            onCheckedChange={(rounds) => setDecide({ rounds })}
          />
        </Setting>
        <Setting
          title="Let agents handle plan deviations within scope"
          description="An agent accepts small amendments that stay inside the plan's files. Anything else pauses the plan for you."
          descriptionId={`${id}-deviations-description`}
        >
          <Switch
            label="Let agents handle plan deviations within scope"
            aria-describedby={`${id}-deviations-description`}
            checked={decide.deviations}
            onCheckedChange={(deviations) => setDecide({ deviations })}
          />
        </Setting>
        <Setting
          title="Deciding agent"
          description="Automatic picks an installed agent from another model family than the one asking."
          descriptionId={`${id}-decider-description`}
        >
          <Select
            aria-label="Deciding agent"
            aria-describedby={`${id}-decider-description`}
            value={decide.decider || 'auto'}
            onValueChange={(decider) => setDecide({ decider })}
          >
            <SelectItem value="auto">Automatic</SelectItem>
            {decide.decider !== 'auto' &&
              !agents.some((runner) => runner.id === decide.decider) && (
                <SelectItem value={decide.decider}>{decide.decider}</SelectItem>
              )}
            {agents.map((runner) => (
              <SelectItem key={runner.id} value={runner.id}>
                {runner.name}
              </SelectItem>
            ))}
          </Select>
        </Setting>
        <Setting
          title="Most agent decisions per plan"
          description="After this many, everything comes to you until the plan is approved again."
          descriptionId={`${id}-limit-description`}
        >
          <Select
            aria-label="Most agent decisions per plan"
            aria-describedby={`${id}-limit-description`}
            value={String(decide.maxAgentDecisions)}
            onValueChange={(value) => setDecide({ maxAgentDecisions: Number(value) })}
          >
            {[...new Set([...DECISION_LIMITS, decide.maxAgentDecisions])]
              .sort((a, b) => a - b)
              .map((limit) => (
                <SelectItem key={limit} value={String(limit)}>
                  {limit} decisions
                </SelectItem>
              ))}
          </Select>
        </Setting>
        <SettingBody>
          <p className="task-muted">
            Always sent to you, whatever these settings say. A committed{' '}
            <code>.jackalope/autonomy.json</code> can only make them stricter.
          </p>
          <ul className="task-muted list-disc pl-5">
            {ALWAYS_YOURS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </SettingBody>
      </SettingGroup>
    </>
  );
}
