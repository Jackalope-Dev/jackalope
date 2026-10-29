import { useEffect, useId, useState } from 'react';
import { useAgentModels } from '../../lib/agent-models';
import { type PlanSettings, planCommands } from '../../lib/plan-mode';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { Setting, SettingGroup } from '../settings/Setting';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';

const QUESTION_LIMITS = Array.from({ length: 13 }, (_, limit) => limit);
const TASK_AGENT = 'task';
const AGENT_DEFAULT = 'default';

/** Plan mode settings for one project: the interview limit, planning agent and model, and where Save to repo writes. */
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
  return (
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
            if (next && next !== settings.exportPath) void save({ ...settings, exportPath: next });
            else setPath(settings.exportPath);
          }}
        />
      </Setting>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </SettingGroup>
  );
}
