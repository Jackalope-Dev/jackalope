import { useProjectStore } from '../../stores/projectStore';
import { AgentPreferences } from '../settings/AgentPreferences';
import { AppearancePreferences } from '../settings/AppearancePreferences';
import { Setting } from '../settings/Setting';
import { Switch } from '../ui/Switch';
import '../settings/settings.css';
export function ProjectPreferences({
  embedded = false,
  projectId,
  section = 'all',
}: {
  embedded?: boolean;
  projectId?: string;
  section?: 'all' | 'repository';
}) {
  const { projects, activeProjectId, updateProject, updateProjectPreferences } = useProjectStore();
  const project = projects.find((p) => p.id === (projectId ?? activeProjectId));
  return (
    <section className={embedded ? 'project-preferences' : 'workspace-page project-preferences'}>
      {!embedded && <h1 className="text-2xl">Project settings</h1>}
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
          </div>
          {section === 'all' && (
            <>
              <section className="project-preferences-section">
                <h2>Agents and accounts</h2>
                <AgentPreferences projectId={project.id} />
              </section>
              <section className="project-preferences-section">
                <h2>Appearance</h2>
                <AppearancePreferences projectId={project.id} />
              </section>
            </>
          )}
          <section className="project-preferences-section">
            <h2>Workspace and verification</h2>
            <div className="project-workspace-fields">
              <div className="project-preference-field">
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
              </div>
              <div className="project-preference-field">
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
                  onChange={(e) =>
                    updateProjectPreferences(project.id, { baseBranch: e.target.value })
                  }
                />
              </div>
              <div className="project-preference-field">
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
              </div>
              <div className="project-preference-field">
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
              </div>
            </div>
            <Setting
              title="Check results automatically"
              description="Run this command after new tasks and scheduled runs finish successfully."
            >
              <Switch
                label="Check results automatically"
                checked={project.preferences?.autoVerify === true}
                onCheckedChange={(autoVerify) =>
                  updateProjectPreferences(project.id, { autoVerify })
                }
              />
            </Setting>
          </section>
        </>
      )}
    </section>
  );
}
