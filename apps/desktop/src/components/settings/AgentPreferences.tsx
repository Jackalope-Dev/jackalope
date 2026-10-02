import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { builtinAgents } from '../../lib/agent-catalog';
import {
  type AgentProfilesView,
  listAgentProfiles,
  setActiveAgentProfile,
} from '../../lib/agent-profiles';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { accountProfiles, useAgentAccountsStore } from '../../stores/agentAccountsStore';
import { syncAgentConfig, useAgentConfigStore } from '../../stores/agentConfigStore';
import { useProjectStore } from '../../stores/projectStore';
import { ProviderMark } from '../agents/ProviderMark';
import { ProjectAccountGroup } from '../projects/ProjectAccountGroup';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Setting, SettingGroup } from './Setting';

export function AgentPreferences({ projectId }: { projectId?: string }) {
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
  const [expanded, setExpanded] = useState<string>();
  const save = async (change: () => void) => {
    const beforeAgents = useAgentConfigStore.getState();
    const beforeProjects = useProjectStore.getState().projects;
    setBusy(true);
    setError('');
    try {
      change();
      if (isTauriEnvironment()) await syncAgentConfig();
    } catch (cause) {
      useAgentConfigStore.setState(beforeAgents);
      useProjectStore.setState({ projects: beforeProjects });
      setError(`Could not save agent preferences: ${String(cause)}`);
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
  return (
    <div className="agent-preferences">
      <SettingGroup>
        <Setting
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
              .filter(
                (agent) =>
                  project ||
                  ['codex', 'claude', 'grok', 'opencode', 'kimi'].includes(
                    'adapter' in agent ? (agent.adapter ?? agent.id) : agent.id,
                  ),
              )
              .map((agent) => (
                <SelectItem key={agent.id} value={agent.id} disabled={!enabled(agent.id)}>
                  {agent.name}
                </SelectItem>
              ))}
          </Select>
        </Setting>
        {!projectId && (
          <Setting
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
          </Setting>
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
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <SettingGroup
        className="agent-preferences-list"
        title="Available agents"
        description="Choose which agents can take work and which of their accounts they use."
      >
        {available.map((agent) => {
          const appEnabled = agents.isAgentEnabled(agent.id);
          const isEnabled = enabled(agent.id);
          const adapter = 'adapter' in agent ? (agent.adapter ?? agent.id) : agent.id;
          const hasAccounts = isEnabled && adapter !== 'antigravity';
          const open = hasAccounts && expanded === agent.id;
          return (
            <section
              key={agent.id}
              className="agent-preference-card"
              aria-label={`${agent.name} preferences`}
            >
              <div className="agent-preference-heading">
                <span className="agent-preference-mark">
                  <ProviderMark provider={adapter} size={20} />
                </span>
                <div>
                  <h3>{agent.name}</h3>
                  {project && !appEnabled && <p className="task-muted">Disabled app-wide</p>}
                </div>
                {hasAccounts && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="agent-preference-toggle"
                    aria-expanded={open}
                    aria-controls={`agent-accounts-${agent.id}`}
                    onClick={() => setExpanded(open ? undefined : agent.id)}
                  >
                    Accounts
                    <ChevronDown
                      className="agent-preference-chevron"
                      size={14}
                      aria-hidden="true"
                    />
                  </Button>
                )}
                <Switch
                  label={`Allow ${agent.name}${project ? ` for ${project.name}` : ' app-wide'}`}
                  checked={isEnabled}
                  disabled={busy || (!!project && !appEnabled)}
                  onCheckedChange={(checked) =>
                    void save(() => {
                      agents.toggleAgent(agent.id, checked, project?.id);
                    })
                  }
                />
              </div>
              {open && (
                <AccountPreferences
                  id={`agent-accounts-${agent.id}`}
                  agentId={adapter}
                  agentName={agent.name}
                  projectId={project?.id}
                  disabled={busy}
                  save={save}
                />
              )}
            </section>
          );
        })}
      </SettingGroup>
      {project && (
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
          Use app defaults
        </Button>
      )}
    </div>
  );
}

function AccountPreferences({
  id,
  agentId,
  agentName,
  projectId,
  disabled,
  save,
}: {
  id: string;
  agentId: string;
  agentName: string;
  projectId?: string;
  disabled: boolean;
  save: (change: () => void) => Promise<void>;
}) {
  const [view, setView] = useState<AgentProfilesView>();
  const statuses = useAgentAccountsStore((state) => state.agents[agentId]?.statuses);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const agents = useAgentConfigStore();
  const { projects, updateProjectPreferences } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      updateProjectPreferences: s.updateProjectPreferences,
    })),
  );
  const project = projects.find((item) => item.id === projectId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Account mutations and retry refresh the profile list.
  useEffect(() => {
    let alive = true;
    if (!isTauriEnvironment()) return;
    void useAgentAccountsStore.getState().load(agentId, true);
    setView(undefined);
    setError('');
    void listAgentProfiles(agentId)
      .then((result) => {
        if (alive) setView(result);
      })
      .catch(() => {
        if (alive) setError('Could not load accounts.');
      });
    return () => {
      alive = false;
    };
  }, [agentId, revision]);
  if (error)
    return (
      <div id={id} className="agent-preference-accounts agent-preference-retry">
        <InlineNotice tone="error">{error}</InlineNotice>
        <Button variant="ghost" onClick={() => setRevision((value) => value + 1)}>
          Retry
        </Button>
      </div>
    );
  if (!view)
    return (
      <div id={id} className="agent-preference-accounts">
        {isTauriEnvironment() ? (
          <LoadingState compact label="Reading accounts…" />
        ) : (
          <p className="task-muted">Accounts are available in the desktop app.</p>
        )}
      </div>
    );
  if (!view.envVar)
    return (
      <div id={id} className="agent-preference-accounts">
        <p className="task-muted">Uses the CLI account.</p>
      </div>
    );
  const accounts = accountProfiles(view, statuses ?? {});
  const blocked = project ? (project.preferences?.disabledAccounts ?? {}) : agents.disabledAccounts;
  const accountEnabled = (id: string) =>
    !agents.disabledAccounts?.[agentId]?.includes(id) && !blocked?.[agentId]?.includes(id);
  return (
    <div id={id} className="agent-preference-accounts">
      <span className="agent-preference-accounts-label">
        {project ? 'Account for this project' : 'Default account'}
      </span>
      <Select
        aria-label={`${agentName} ${project ? 'project' : 'default'} account`}
        value={
          project
            ? (project.preferences?.agentAccounts?.[agentId] ?? 'inherit')
            : (view.activeId ?? '__default')
        }
        disabled={disabled}
        onValueChange={(id) => {
          if (project)
            void save(() => {
              const agentAccounts = { ...project.preferences?.agentAccounts };
              if (id === 'inherit') delete agentAccounts[agentId];
              else agentAccounts[agentId] = id;
              updateProjectPreferences(project.id, { agentAccounts });
            });
          else
            void setActiveAgentProfile(agentId, id === '__default' ? null : id)
              .then(() => setRevision((value) => value + 1))
              .catch(() => setError('Could not change the default account.'));
        }}
      >
        {project && <SelectItem value="inherit">Automatic · enabled accounts</SelectItem>}
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id} disabled={!accountEnabled(account.id)}>
            {account.name}
          </SelectItem>
        ))}
      </Select>
      {accounts.length > 1 && (
        <span className="agent-preference-accounts-label">Accounts agents may use</span>
      )}
      {accounts.length > 1 &&
        accounts.map((account) => (
          <div key={account.id} className="agent-account-permission">
            <span>
              {account.name}
              {project && agents.disabledAccounts?.[agentId]?.includes(account.id) && (
                <small>Disabled app-wide</small>
              )}
            </span>
            <Switch
              label={`Allow ${agentName} account ${account.name}`}
              checked={accountEnabled(account.id)}
              disabled={
                disabled ||
                (!!project && !!agents.disabledAccounts?.[agentId]?.includes(account.id))
              }
              onCheckedChange={(checked) =>
                void save(() => {
                  const ids = blocked?.[agentId] ?? [];
                  const disabledAccounts = {
                    ...blocked,
                    [agentId]: checked
                      ? ids.filter((id) => id !== account.id)
                      : [...new Set([...ids, account.id])],
                  };
                  if (project) updateProjectPreferences(project.id, { disabledAccounts });
                  else useAgentConfigStore.setState({ disabledAccounts });
                })
              }
            />
          </div>
        ))}
    </div>
  );
}
