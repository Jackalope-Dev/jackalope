import { ArrowRight, Bot, GitBranch } from 'lucide-react';
import type { ReactNode } from 'react';
import { agentCapabilities, connectionSupport } from '../../lib/agent-capabilities';
import type { Runner } from '../../lib/task-runtime';
import type { McpServerConfig } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import type { TaskDraft } from '../../stores/executionStore';
import { TaskKnowledge } from '../knowledge/TaskKnowledge';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { TaskContextPanel } from './TaskContextPanel';

interface Props {
  context?: ReactNode;
  setup?: ReactNode;
  executionReady?: boolean;
  projectId: string;
  projectPath: string;
  current: TaskDraft;
  currentAgent: string;
  runner: Runner | undefined;
  allowedRunners: Runner[];
  submitting: boolean;
  desktop: boolean;
  activeSkills: string[];
  suggestedSkills: string[];
  projectInstructions?: string;
  finalPrompt: string;
  projectConnections: McpServerConfig[];
  editingIdea: boolean;
  toggleSkill: (id: string) => void;
  onChange: (value: Partial<TaskDraft>) => void;
  onLaunch: () => Promise<void>;
  onSave: () => void;
}

export function TaskComposer({
  context,
  setup,
  executionReady = true,
  projectId,
  projectPath,
  current,
  currentAgent,
  runner,
  allowedRunners,
  submitting,
  desktop,
  activeSkills,
  suggestedSkills,
  projectInstructions,
  finalPrompt,
  projectConnections,
  editingIdea,
  toggleSkill,
  onChange,
  onLaunch,
  onSave,
}: Props) {
  const customAgents = useAgentConfigStore((state) => state.customAgents);
  const adapter = customAgents.find((agent) => agent.id === currentAgent)?.adapter ?? currentAgent;
  const support = agentCapabilities(adapter);
  const incompatible = projectConnections.filter(
    (server) =>
      (current.connectionIds ?? projectConnections.map((server) => server.id)).includes(
        server.id,
      ) && connectionSupport(adapter, server.transport, server.discovery === true),
  );
  return (
    <form
      id="task-composer"
      className="task-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (executionReady) {
          if (!incompatible.length) void onLaunch();
        } else if (current.prompt.trim() && !submitting) onSave();
      }}
    >
      <fieldset disabled={submitting} className="contents">
        <label htmlFor="task-intent" className="sr-only">
          What do you want to accomplish?
        </label>
        <textarea
          id="task-intent"
          value={current.prompt}
          onChange={(event) => onChange({ prompt: event.target.value })}
          placeholder="Describe a change, investigate a problem, or explore an idea…"
          rows={4}
          maxLength={24000}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              !submitting &&
              current.prompt.trim() &&
              (!executionReady || (runner?.available && desktop && !incompatible.length))
            ) {
              event.preventDefault();
              if (executionReady) void onLaunch();
              else onSave();
            }
          }}
        />
        {context}
        <details className="capture-options">
          <summary>
            Task options
            {executionReady && (
              <span className="capture-options-summary">
                {runner?.name || 'Choose an agent'} ·{' '}
                {current.isolated ? 'Separate workspace' : 'Current checkout'}
              </span>
            )}
          </summary>
          <div className="task-context-controls">
            <label htmlFor="taskworkspace-field-2" className="task-context-chip">
              <Bot size={18} aria-hidden="true" />
              <span className="sr-only">Agent</span>
              <Select
                id="taskworkspace-field-2"
                aria-label="Agent"
                value={currentAgent}
                onValueChange={(value) => onChange({ agent: value })}
              >
                {allowedRunners.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </Select>
            </label>
            <label htmlFor="taskworkspace-field-3" className="task-context-chip">
              <span className="sr-only">Execution location</span>
              <GitBranch size={13} />
              <Select
                id="taskworkspace-field-3"
                aria-label="Execution location"
                value={current.isolated ? 'isolated' : 'current'}
                onValueChange={(value) => onChange({ isolated: value === 'isolated' })}
              >
                <SelectItem value="isolated">Separate workspace</SelectItem>
                <SelectItem value="current">Current checkout</SelectItem>
              </Select>
            </label>
          </div>
          {projectId && projectPath && (
            <TaskKnowledge
              key={projectId}
              projectId={projectId}
              projectPath={projectPath}
              prompt={finalPrompt}
              selection={current.contextSelection}
              onChange={(contextSelection) => onChange({ contextSelection })}
            />
          )}
          <TaskContextPanel
            selected={activeSkills}
            suggested={suggestedSkills}
            onToggle={toggleSkill}
            instructions={projectInstructions}
            prompt={current.prompt.trim() ? finalPrompt : ''}
          />
          {support && (
            <p className="task-muted">
              Project awareness, messages, questions and evidence:{' '}
              {support.bridge === 'mcp'
                ? 'built-in tools'
                : 'available through permitted shell/network tools'}
              . {support.accounts ? '' : 'Uses the current CLI account.'}
            </p>
          )}
          {projectConnections.length > 0 && (
            <details className="my-3">
              <summary>
                Project tools for this task (
                {current.connectionIds?.length ?? projectConnections.length})
              </summary>
              <p className="task-muted">
                Applies to project connections only. Your agent's own configured tools remain
                available.
              </p>
              {projectConnections.map((server) => (
                <label key={server.id} className="flex items-center gap-3 min-h-11">
                  <input
                    type="checkbox"
                    checked={(
                      current.connectionIds ?? projectConnections.map((s) => s.id)
                    ).includes(server.id)}
                    onChange={(event) => {
                      const selected = current.connectionIds ?? projectConnections.map((s) => s.id);
                      onChange({
                        connectionIds: event.target.checked
                          ? [...selected, server.id]
                          : selected.filter((id) => id !== server.id),
                      });
                    }}
                  />
                  {server.name}
                  {server.discovery ? ' · On demand' : ''}
                  {connectionSupport(adapter, server.transport, server.discovery === true) && (
                    <span className="task-muted">
                      {' '}
                      · {connectionSupport(adapter, server.transport, server.discovery === true)}
                    </span>
                  )}
                </label>
              ))}
            </details>
          )}
          {setup}
        </details>
        {incompatible.length > 0 && (
          <p role="alert" className="task-error">
            Selected tools need attention: {incompatible.map((server) => server.name).join(', ')}.
            Enable on-demand tools in MCP settings, deselect the connection, or choose a compatible
            agent.
          </p>
        )}
        {executionReady && (
          <p className="task-composer-note">
            {current.isolated
              ? 'Starts from the target branch’s latest commit. Uncommitted changes are excluded.'
              : 'Edits this checkout, including existing changes.'}{' '}
            {runner?.available
              ? runner.signedIn
                ? 'Uses your existing sign-in.'
                : 'Sign-in will be checked by the agent when it starts.'
              : 'This agent is not available yet.'}
          </p>
        )}
        <div className="task-composer-footer">
          <div className="flex flex-wrap gap-2">
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
                disabled={
                  !desktop ||
                  !current.prompt.trim() ||
                  !runner?.available ||
                  submitting ||
                  incompatible.length > 0
                }
              >
                {submitting ? 'Starting…' : 'Start task'}
                <ArrowRight size={15} />
              </Button>
            )}
          </div>
        </div>
      </fieldset>
    </form>
  );
}
