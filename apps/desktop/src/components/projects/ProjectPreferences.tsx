import { builtinAgents } from '../../lib/agent-catalog';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { isAgentAllowedForProject, useProjectStore } from '../../stores/projectStore';
import { ProjectAgentAccount } from '../settings/ProjectAgentAccount';
import { Setting } from '../settings/Setting';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { ProjectAccountGroup } from './ProjectAccountGroup';
import '../settings/settings.css';
export function ProjectPreferences() {
  const agents = useAgentConfigStore();
  const { projects, activeProjectId, updateProject, updateProjectPreferences } = useProjectStore();
  const project = projects.find((p) => p.id === activeProjectId);
  return (
    <section className="workspace-page">
      <h1 className="text-2xl">Project settings</h1>
      {project && <p className="task-muted mt-2">{project.name}</p>}
      {!project ? (
        <p className="settings-section-subtitle mt-4">
          Open a repository to configure project preferences.
        </p>
      ) : (
        <>
          <div className="settings-group">
            <Setting title="Project name">
              <input
                className="settings-input"
                aria-label="Project name"
                value={project.name}
                onChange={(e) => updateProject(project.id, { name: e.target.value })}
              />
            </Setting>
            <Setting title="Repository path" description={project.path} />
            <Setting title="Default task agent">
              <Select
                aria-label="Default task agent"
                value={project.preferences?.preferredRunner ?? 'inherit'}
                onValueChange={(value) =>
                  updateProjectPreferences(project.id, { preferredRunner: value })
                }
              >
                <SelectItem value="inherit">App default</SelectItem>
                {[...builtinAgents, ...agents.customAgents].map((a) => (
                  <SelectItem
                    key={a.id}
                    value={a.id}
                    disabled={
                      !agents.isAgentEnabled(a.id) || !isAgentAllowedForProject(project, a.id)
                    }
                  >
                    {a.name}
                  </SelectItem>
                ))}
              </Select>
            </Setting>
          </div>
          <ProjectAccountGroup
            key={project.id}
            agents={builtinAgents.filter(
              (agent) =>
                agents.isAgentEnabled(agent.id) && isAgentAllowedForProject(project, agent.id),
            )}
            value={project.preferences?.agentAccounts ?? {}}
            onChange={(agentAccounts) => updateProjectPreferences(project.id, { agentAccounts })}
          />
          <div className="settings-group">
            <Setting title="Agents available here" />
            {[...builtinAgents, ...agents.customAgents].map((a) => {
              const allIds = [
                ...builtinAgents.map((a) => a.id),
                ...agents.customAgents.map((c) => c.id),
              ];
              const restricted = project.preferences?.allowedAgents;
              const isOn = restricted === undefined || restricted.includes(a.id);
              return (
                <Setting
                  key={a.id}
                  title={a.name}
                  description={
                    !agents.isAgentEnabled(a.id)
                      ? 'Disabled app-wide in Agent settings.'
                      : undefined
                  }
                >
                  <Switch
                    checked={isOn}
                    onCheckedChange={(checked) => {
                      const current = restricted ?? allIds;
                      const next = checked
                        ? [...new Set([...current, a.id])]
                        : current.filter((id) => id !== a.id);
                      updateProjectPreferences(project.id, {
                        allowedAgents: next.length === allIds.length ? undefined : next,
                      });
                    }}
                    label={`Allow ${a.name} for ${project.name}`}
                  />
                  {!('isCustom' in a) && isOn && agents.isAgentEnabled(a.id) && (
                    <ProjectAgentAccount
                      agentId={a.id}
                      agentName={a.name}
                      projectName={project.name}
                      value={project.preferences?.agentAccounts?.[a.id]}
                      onChange={(id) => {
                        const next = {
                          ...(project.preferences?.agentAccounts ?? {}),
                        };
                        if (id) next[a.id] = id;
                        else delete next[a.id];
                        updateProjectPreferences(project.id, {
                          agentAccounts: next,
                        });
                      }}
                    />
                  )}
                </Setting>
              );
            })}
            {project.preferences?.allowedAgents?.length === 0 && (
              <p className="task-error">
                No agents are allowed here — tasks can’t start until you enable at least one.
              </p>
            )}
          </div>
          <label className="block text-sm font-medium" htmlFor="project-instructions">
            Project instructions
          </label>
          <p className="settings-row-description mb-3">
            Appended to prompts launched from the task composer.
          </p>
          <textarea
            id="project-instructions"
            className="settings-textarea"
            rows={5}
            value={project.preferences?.customInstructions ?? ''}
            onChange={(e) =>
              updateProjectPreferences(project.id, {
                customInstructions: e.target.value,
              })
            }
          />
          <label className="block text-sm font-medium mt-6" htmlFor="project-base-branch">
            Target branch
          </label>
          <p className="settings-row-description mb-3">
            Starting branch for new tasks and their review.
          </p>
          <input
            id="project-base-branch"
            className="settings-input w-full"
            value={project.preferences?.baseBranch ?? ''}
            placeholder={project.gitBranch}
            onChange={(e) => updateProjectPreferences(project.id, { baseBranch: e.target.value })}
          />
          <label className="block text-sm font-medium mt-6" htmlFor="preparation-command">
            Workspace preparation
          </label>
          <p className="settings-row-description mb-3">
            Runs before new tasks, with your OS permissions. Five-minute limit; skipped for
            continuations.
          </p>
          <input
            id="preparation-command"
            className="settings-input w-full"
            value={project.preferences?.prepareCommand ?? ''}
            placeholder="pnpm install --frozen-lockfile"
            onChange={(event) =>
              updateProjectPreferences(project.id, { prepareCommand: event.target.value })
            }
          />
          <label className="block text-sm font-medium mt-6" htmlFor="verification-command">
            Verification command
          </label>
          <p className="settings-row-description mb-3">
            Runs with your OS permissions. Five-minute limit.
          </p>
          <input
            id="verification-command"
            className="settings-input w-full"
            value={project.preferences?.verifyCommand ?? ''}
            placeholder="pnpm build"
            onChange={(e) =>
              updateProjectPreferences(project.id, {
                verifyCommand: e.target.value,
              })
            }
          />
          <Setting
            title="Check results automatically"
            description="Run this command after new tasks and scheduled runs finish successfully."
          >
            <Switch
              label="Check results automatically"
              checked={project.preferences?.autoVerify === true}
              onCheckedChange={(autoVerify) => updateProjectPreferences(project.id, { autoVerify })}
            />
          </Setting>
        </>
      )}
    </section>
  );
}
