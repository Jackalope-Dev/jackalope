import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  Cpu,
  Folder,
  GitBranch,
  Layers,
  Plug,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { effortFor, taskEfforts } from '../../lib/task-effort';
import type { Runner } from '../../lib/task-runtime';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import type { TaskDraft } from '../../stores/executionStore';
import { TaskKnowledge } from '../knowledge/TaskKnowledge';
import { Button } from '../ui/button';
import { OutcomeEditor } from './OutcomeEditor';
import { TaskContextPanel } from './TaskContextPanel';
import './task-composer.css';

interface Props {
  inline?: boolean;
  context?: ReactNode;
  setup?: ReactNode;
  workspaceSetup?: ReactNode;
  executionReady?: boolean;
  projectId: string;
  projectPath: string;
  current: TaskDraft;

  automaticAgent?: string;
  automaticRationale?: string;
  models: string[];
  defaultModel: string;
  runner: Runner | undefined;
  allowedRunners: Runner[];
  submitting: boolean;
  desktop: boolean;
  activeSkills: string[];
  suggestedSkills: string[];
  projectInstructions?: string;
  finalPrompt: string;
  projectConnections: McpServerConfig[];
  connectionIssues: Record<string, string>;
  editingIdea: boolean;
  toggleSkill: (id: string) => void;
  onChange: (value: Partial<TaskDraft>) => void;
  onLaunch: () => Promise<void>;
  onSave: () => void;
  onSplitTask?: () => void;
}

const effortIcons = [Zap, Layers, ShieldCheck];

export function TaskComposer({
  inline = false,
  context,
  setup,
  workspaceSetup,
  executionReady = true,
  projectId,
  projectPath,
  current,
  automaticAgent,
  automaticRationale,
  models,
  defaultModel,
  runner,
  allowedRunners,
  submitting,
  desktop,
  activeSkills,
  suggestedSkills,
  projectInstructions,
  finalPrompt,
  projectConnections,
  connectionIssues,
  editingIdea,
  toggleSkill,
  onChange,
  onLaunch,
  onSave,
  onSplitTask,
}: Props) {
  const [panel, setPanel] = useState<string | null>(null);
  const effort = effortFor(current.effort);
  const effortIndex = taskEfforts.indexOf(effort);
  const toolCount = projectConnections.filter(
    (server) => !current.connectionIds || current.connectionIds.includes(server.id),
  ).length;
  const controls = [
    {
      id: 'agent',
      icon: Bot,
      label: 'Agent',
      value: current.agent
        ? runner?.name || 'Unavailable'
        : `Auto · ${runner?.name || 'No agent'}${automaticRationale ? ` (${automaticRationale})` : ''}`,
    },
    {
      id: 'workspace',
      icon: GitBranch,
      label: 'Workspace',
      value: current.isolated ? 'Separate worktree' : 'Current checkout',
    },
    {
      id: 'context',
      icon: BookOpen,
      label: 'Context',
      value: `${current.contextSelection?.memoryOff ? 'Lessons off' : 'Matching lessons'}${activeSkills.length ? ` · ${activeSkills.length} guidelines` : ''}`,
    },
    {
      id: 'tools',
      icon: Plug,
      label: 'Tools',
      value: `${toolCount} project ${toolCount === 1 ? 'tool' : 'tools'}`,
    },
  ];
  const outcomes = (
    <>
      <OutcomeEditor
        values={current.contextSelection?.outcomes ?? []}
        onChange={(outcomes) =>
          onChange({ contextSelection: { ...current.contextSelection, outcomes } })
        }
      />
      <p className="task-muted mb-4">
        Added requirements need your evidence review before review or integration.
      </p>
    </>
  );
  return (
    <>
      <form
        id="task-composer"
        className="task-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (executionReady) void onLaunch();
          else if (current.prompt.trim() && !submitting) onSave();
        }}
      >
        <fieldset disabled={submitting} className="contents">
          <label htmlFor="task-intent" className="sr-only">
            What do you want to accomplish?
          </label>
          <textarea
            id="task-intent"
            className="composer-intent"
            value={current.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
            placeholder="Describe a change, investigate a problem, or explore an idea…"
            rows={inline ? 4 : 3}
            maxLength={24000}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing &&
                !submitting &&
                current.prompt.trim() &&
                (!executionReady || (runner?.available && desktop))
              ) {
                event.preventDefault();
                if (executionReady) void onLaunch();
                else onSave();
              }
            }}
          />
          {context}
          <div className="composer-configuration">
            <section
              className="composer-effort"
              aria-labelledby="effort-label"
              style={{ '--effort-position': `${effortIndex * 50}%` } as CSSProperties}
            >
              <div className="composer-section-heading">
                <span id="effort-label">Level of effort</span>
                <span>More depth, more time & usage</span>
              </div>
              <div className="composer-effort-choices">
                {taskEfforts.map((option, index) => {
                  const Icon = effortIcons[index];
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={effort.id === option.id}
                      title={option.description}
                      onClick={() => onChange({ effort: option.id })}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>{option.name}</span>
                      {effort.id === option.id && <Check size={14} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              {!inline && (
                <input
                  id="task-effort"
                  aria-labelledby="effort-label"
                  className="composer-effort-slider"
                  type="range"
                  min={0}
                  max={2}
                  step={1}
                  value={effortIndex}
                  aria-valuetext={`${effort.name}: ${effort.description}`}
                  aria-describedby="effort-description"
                  onChange={(event) =>
                    onChange({ effort: taskEfforts[Number(event.target.value)].id })
                  }
                />
              )}
              <p id="effort-description" className="composer-effort-description" aria-live="polite">
                {effort.description}
              </p>
            </section>
            <fieldset className="composer-config" aria-label="Task configuration">
              {controls.map(({ id, icon: Icon, label, value }) => (
                <button
                  key={id}
                  id={`composer-control-${id}`}
                  type="button"
                  className="composer-config-button"
                  aria-expanded={panel === id}
                  aria-controls={`composer-panel-${id}`}
                  onClick={() => setPanel(panel === id ? null : id)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <span>{value}</span>
                  </span>
                </button>
              ))}
            </fieldset>
          </div>
          {controls.map(({ id }) => (
            <section
              key={id}
              id={`composer-panel-${id}`}
              hidden={panel !== id}
              aria-labelledby={`composer-control-${id}`}
              className="composer-config-panel"
            >
              {id === 'agent' && (
                <>
                  <div className="composer-section-heading">
                    <span>Lead agent</span>
                    <span>One agent per task</span>
                  </div>
                  <div className="composer-choice-grid">
                    <button
                      type="button"
                      className="composer-choice"
                      aria-pressed={!current.agent}
                      onClick={() => onChange({ agent: '', model: undefined })}
                    >
                      <Sparkles size={20} aria-hidden="true" />
                      <span>
                        <strong>Let Jackalope choose</strong>
                        <span>
                          {automaticAgent
                            ? `${automaticAgent} selects an agent, model and account for this task and its quota needs.`
                            : 'Connect an agent to get started'}
                        </span>
                      </span>
                    </button>
                    {allowedRunners.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        className="composer-choice"
                        aria-pressed={current.agent === agent.id}
                        onClick={() => onChange({ agent: agent.id, model: undefined })}
                      >
                        <Bot size={20} aria-hidden="true" />
                        <span>
                          <strong>{agent.name}</strong>
                          <span>{agent.available ? 'Available' : 'Needs setup'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {current.agent && (
                    <>
                      <div className="composer-section-heading mt-4">
                        <span>Model</span>
                        <Cpu size={16} aria-hidden="true" />
                      </div>
                      <div className="composer-models">
                        <button
                          type="button"
                          aria-pressed={!current.model}
                          onClick={() => onChange({ model: undefined })}
                        >
                          {defaultModel ? `Default · ${defaultModel}` : 'Agent default'}
                        </button>
                        {models.map((model) => (
                          <button
                            key={model}
                            type="button"
                            aria-pressed={current.model === model}
                            onClick={() => onChange({ model })}
                          >
                            {model}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {id === 'workspace' && (
                <div className="composer-choice-grid">
                  <button
                    type="button"
                    className="composer-choice"
                    aria-pressed={current.isolated}
                    onClick={() => onChange({ isolated: true })}
                  >
                    <GitBranch size={20} aria-hidden="true" />
                    <span>
                      <strong>Separate worktree</strong>
                      <span>Starts from the target branch; excludes uncommitted changes.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="composer-choice"
                    aria-pressed={!current.isolated}
                    onClick={() => onChange({ isolated: false })}
                  >
                    <Folder size={20} aria-hidden="true" />
                    <span>
                      <strong>Current checkout</strong>
                      <span>Edits your files, including uncommitted changes.</span>
                    </span>
                  </button>
                </div>
              )}
              {id === 'workspace' && workspaceSetup}
              {id === 'context' && panel === id && (
                <>
                  {projectId && projectPath && (
                    <TaskKnowledge
                      embedded
                      key={projectId}
                      projectId={projectId}
                      projectPath={projectPath}
                      prompt={finalPrompt}
                      selection={current.contextSelection}
                      onChange={(contextSelection) => onChange({ contextSelection })}
                    />
                  )}
                  <TaskContextPanel
                    embedded
                    selected={activeSkills}
                    suggested={suggestedSkills}
                    onToggle={toggleSkill}
                    instructions={projectInstructions}
                    prompt={current.prompt.trim() ? finalPrompt : ''}
                  />
                </>
              )}
              {id === 'tools' && (
                <>
                  {!projectConnections.length && (
                    <p className="task-muted mt-3">
                      {projectId
                        ? 'No project tools connected yet.'
                        : 'Choose a project to configure its tools.'}
                    </p>
                  )}
                  {projectConnections.map((server) => (
                    <label key={server.id} className="flex items-center gap-3 min-h-11">
                      <input
                        type="checkbox"
                        checked={(
                          current.connectionIds ?? projectConnections.map((s) => s.id)
                        ).includes(server.id)}
                        onChange={(event) => {
                          const selected =
                            current.connectionIds ?? projectConnections.map((s) => s.id);
                          onChange({
                            connectionIds: event.target.checked
                              ? [...selected, server.id]
                              : selected.filter((value) => value !== server.id),
                          });
                        }}
                      />
                      <span>
                        {server.name}
                        {server.discovery ? ' · On demand' : ''}
                        {connectionIssues[server.id] && (
                          <span className="task-muted block text-xs">
                            {connectionIssues[server.id]}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </>
              )}
              {(id === 'agent' || id === 'tools') && setup}
            </section>
          ))}
          {inline ? (
            <details className="composer-outcomes">
              <summary>
                Requirements
                {current.contextSelection?.outcomes?.length
                  ? ` · ${current.contextSelection.outcomes.length}`
                  : ' · optional'}
              </summary>
              {outcomes}
            </details>
          ) : (
            outcomes
          )}
        </fieldset>
      </form>
      <div className="task-composer-footer">
        {inline && (
          <span className="composer-dispatch-note">
            {executionReady
              ? current.isolated
                ? 'Runs in a separate worktree'
                : 'Edits your current checkout'
              : 'Save an idea now. Choose a project when you’re ready.'}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          {onSplitTask && current.prompt.trim().length > 25 && (
            <Button type="button" variant="outline" disabled={submitting} onClick={onSplitTask}>
              <Sparkles size={15} />
              Split into subtasks
            </Button>
          )}
          <Button
            type="button"
            variant={executionReady ? 'ghost' : 'primary'}
            disabled={!current.prompt.trim() || submitting}
            onClick={onSave}
          >
            {editingIdea ? 'Save idea' : 'Save for later'}
          </Button>
          {executionReady && (
            <Button
              type="submit"
              form="task-composer"
              disabled={!desktop || !current.prompt.trim() || !runner?.available || submitting}
            >
              {submitting ? 'Starting…' : 'Start task'}
              <ArrowRight size={15} />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
