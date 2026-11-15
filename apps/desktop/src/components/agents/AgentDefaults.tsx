import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  Select,
  SelectItem,
  SettingActions,
  SettingGroup,
  SettingRow,
  Switch,
} from '@jackalope/ui';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { builtinAgents, canOrchestrate } from '../../lib/agent-catalog';
import { isTauriEnvironment } from '../../lib/native/env';
import { agentPolicySaved, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useProjectStore } from '../../stores/projectStore';
import { ProjectAccountGroup } from '../projects/ProjectAccountGroup';
import { ActionError } from '../ui/ActionError';

/**
 * Choices that apply across agents: which one starts new work, quota handoff and,
 * for a project, its account groups. Per-agent enablement, accounts and models
 * live on each agent's card and configuration page.
 */
export function AgentDefaults({ projectId }: { projectId?: string }) {
  const agents = useAgentConfigStore();
  const { projects, updateProjectPreferences } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      updateProjectPreferences: s.updateProjectPreferences,
    })),
  );
  const project = projects.find((item) => item.id === projectId);
  const available = [...builtinAgents, ...agents.customAgents];
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (change: () => void) => {
    const beforeAgents = useAgentConfigStore.getState();
    const beforeProjects = useProjectStore.getState().projects;
    setBusy(true);
    setError('');
    try {
      change();
      if (isTauriEnvironment()) await agentPolicySaved();
    } catch (cause) {
      useAgentConfigStore.setState(beforeAgents);
      useProjectStore.setState({ projects: beforeProjects });
      setError(`Could not save agent defaults: ${describeError(cause)}`);
    } finally {
      setBusy(false);
    }
  };
  const enabled = (id: string) =>
    agents.isAgentEnabled(id) &&
    (!project?.preferences?.allowedAgents || project.preferences.allowedAgents.includes(id));
  const defaultAgent = project
    ? (project.preferences?.preferredRunner ?? 'inherit')
    : agents.defaultMetaAgent || 'none';
  const customized =
    !!project?.preferences &&
    (project.preferences.allowedAgents !== undefined ||
      project.preferences.disabledAccounts !== undefined ||
      project.preferences.agentAccounts !== undefined ||
      project.preferences.preferredRunner !== undefined);
  return (
    <div className="workspace-stack">
      <SettingGroup title="Defaults">
        <SettingRow
          title={project ? 'Default task agent' : 'Default orchestration agent'}
          description={
            project
              ? 'Used for new work in this project. Individual tasks can choose another enabled agent or automatic routing.'
              : 'Coordinates tasks and chooses among enabled agents and accounts.'
          }
        >
          <Select
            aria-label={project ? 'Default task agent' : 'Default orchestration agent'}
            value={defaultAgent}
            disabled={busy}
            onValueChange={(value) =>
              void save(() =>
                project
                  ? updateProjectPreferences(project.id, {
                      preferredRunner: value === 'inherit' ? undefined : value,
                    })
                  : agents.setDefaultMetaAgent(value),
              )
            }
          >
            {project ? (
              <SelectItem value="inherit">Let Jackalope choose</SelectItem>
            ) : (
              !agents.defaultMetaAgent && (
                <SelectItem value="none" disabled>
                  Choose an agent
                </SelectItem>
              )
            )}
            {available
              .filter((agent) => project || canOrchestrate(agent.id, agents.customAgents))
              .map((agent) => (
                <SelectItem key={agent.id} value={agent.id} disabled={!enabled(agent.id)}>
                  {agent.name}
                </SelectItem>
              ))}
          </Select>
        </SettingRow>
        {!project && (
          <SettingRow
            title="Automatic quota handoff"
            description="Continue eligible tasks with another enabled agent when an account reaches its limit."
          >
            <Switch
              label="Automatic quota handoff"
              checked={agents.automaticQuotaHandoff}
              disabled={busy || !isTauriEnvironment()}
              onCheckedChange={(automaticQuotaHandoff) =>
                void save(() => useAgentConfigStore.setState({ automaticQuotaHandoff }))
              }
            />
          </SettingRow>
        )}
        {project && customized && (
          <SettingActions>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void save(() =>
                  updateProjectPreferences(project.id, {
                    allowedAgents: undefined,
                    disabledAccounts: undefined,
                    agentAccounts: undefined,
                    preferredRunner: undefined,
                  }),
                )
              }
            >
              Use app defaults for this project
            </Button>
          </SettingActions>
        )}
      </SettingGroup>
      {project && (
        <ProjectAccountGroup
          key={project.id}
          agents={builtinAgents.filter((agent) => enabled(agent.id))}
          value={project.preferences?.agentAccounts ?? {}}
          onChange={(agentAccounts) =>
            void save(() => updateProjectPreferences(project.id, { agentAccounts }))
          }
        />
      )}
      <ActionError error={error} />
    </div>
  );
}
