import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { isAgentAllowedForProject, useProjectStore } from '../../stores/projectStore';
import { ProjectAgentAccount } from '../settings/ProjectAgentAccount';
import { Setting } from '../settings/Setting';
import { CodebaseMemoryBar } from '../tasks/CodebaseMemoryBar';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import '../settings/settings.css';
export function ProjectPreferences() {
  const agents = useAgentConfigStore();
  const { projects, activeProjectId, selectProject, updateProject, updateProjectPreferences } =
    useProjectStore();
  const project = projects.find((p) => p.id === activeProjectId);
  return (
    <section className="workspace-page">
      <h1 className="text-2xl">Project context</h1>
      {project && <CodebaseMemoryBar project={project} initiallyExpanded />}{' '}
      {!project ? (
        <p className="settings-section-subtitle mt-4">
          Open a repository to configure project preferences.
        </p>
      ) : (
        <>
          <div className="my-6">
            <Select
              aria-label="Project to configure"
              value={project.id}
              onValueChange={selectProject}
            >
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="settings-group">
            <Setting title="Project name" description="Label shown in the project switcher.">
              <input
                className="settings-input"
                aria-label="Project name"
                value={project.name}
                onChange={(e) => updateProject(project.id, { name: e.target.value })}
              />
            </Setting>
            <Setting title="Repository path" description={project.path} />
            <Setting
              title="Default task agent"
              description="Used for new tasks unless the composer has an explicit selection."
            >
              <Select
                aria-label="Default task agent"
                value={project.preferences?.preferredRunner ?? 'inherit'}
                onValueChange={(value) =>
                  updateProjectPreferences(project.id, { preferredRunner: value })
                }
              >
                <SelectItem value="inherit">App default</SelectItem>
                {[
                  { id: 'codex', name: 'Codex' },
                  { id: 'claude', name: 'Claude Code' },
                  { id: 'grok', name: 'Grok' },
                  ...agents.customAgents,
                ].map((a) => (
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
          <div className="settings-group">
            <Setting
              title="Agents available here"
              description="Restrict which agents can be picked for this project's tasks — handy for keeping work projects on one agent and personal ones on another. Leave every agent on to allow all app-enabled agents."
            />
            {[
              { id: 'codex', name: 'Codex' },
              { id: 'claude', name: 'Claude Code' },
              { id: 'grok', name: 'Grok' },
              ...agents.customAgents,
            ].map((a) => {
              const allIds = ['codex', 'claude', 'grok', ...agents.customAgents.map((c) => c.id)];
              const restricted = project.preferences?.allowedAgents;
              const isOn = restricted === undefined || restricted.includes(a.id);
              return (
                <Setting
                  key={a.id}
                  title={a.name}
                  description={
                    !agents.isAgentEnabled(a.id)
                      ? 'Disabled app-wide in Agent settings.'
                      : isOn
                        ? `Available for ${project.name}.`
                        : `Not allowed for ${project.name}.`
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
            New tasks start from this local branch. Their review keeps the same target even if you
            switch branches later.
          </p>
          <input
            id="project-base-branch"
            className="settings-input w-full"
            value={project.preferences?.baseBranch ?? ''}
            placeholder={project.gitBranch}
            onChange={(e) => updateProjectPreferences(project.id, { baseBranch: e.target.value })}
          />
          <label className="block text-sm font-medium mt-6" htmlFor="verification-command">
            Verification command
          </label>
          <p className="settings-row-description mb-3">
            Run from task review, or by an agent through the verification tool. Commands use your OS
            permissions and stop after five minutes.
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
          <p className="settings-disclosure-box">
            Choose isolation in the task composer. Isolated tasks use .worktrees and the selected
            target branch. Custom worktree locations and automatic cleanup are planned.
          </p>
        </>
      )}
    </section>
  );
}
