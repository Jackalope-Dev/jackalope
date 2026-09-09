import { useProjectStore } from '../../stores/projectStore';
import { AgentPreferences } from '../settings/AgentPreferences';
import { AppearancePreferences } from '../settings/AppearancePreferences';
import { Setting } from '../settings/Setting';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { RemoveProjectAction } from './RemoveProjectAction';
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
      {!embedded && <WorkspaceHeading title="Project settings" description={project?.name} />}
      {!project ? (
        <p className="settings-section-subtitle mt-4">
          Open a repository to configure project preferences.
        </p>
      ) : (
        <>
          <div className="project-workspace-fields project-identity-fields">
            <div className="project-preference-field">
              <label htmlFor="project-name">Project name</label>
              <input
                id="project-name"
                className="settings-input"
                value={project.name}
                onChange={(e) => updateProject(project.id, { name: e.target.value })}
              />
            </div>
            <div className="project-preference-field">
              <span className="project-field-label">Repository path</span>
              <p className="project-repository-path">{project.path}</p>
            </div>
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
            <h2>Task instructions</h2>
            <div className="project-workspace-fields">
              <div className="project-preference-field">
                <label htmlFor="project-instructions">Project instructions</label>
                <p id="project-instructions-help" className="settings-row-description">
                  Appended to prompts launched from the task composer.
                </p>
                <textarea
                  id="project-instructions"
                  aria-describedby="project-instructions-help"
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
            </div>
          </section>
          <section className="project-preferences-section">
            <h2>Workspace</h2>
            <div className="project-workspace-fields">
              <div className="project-preference-field">
                <label htmlFor="project-base-branch">Target branch</label>
                <p id="project-base-branch-help" className="settings-row-description">
                  Starting branch for new tasks and their review.
                </p>
                <input
                  id="project-base-branch"
                  aria-describedby="project-base-branch-help"
                  className="settings-input w-full"
                  value={project.preferences?.baseBranch ?? ''}
                  placeholder={project.gitBranch}
                  onChange={(e) =>
                    updateProjectPreferences(project.id, { baseBranch: e.target.value })
                  }
                />
              </div>
              <div className="project-preference-field">
                <label htmlFor="preparation-command">Workspace preparation</label>
                <p id="preparation-command-help" className="settings-row-description">
                  Runs before new tasks, with your OS permissions. Five-minute limit; skipped for
                  continuations.
                </p>
                <input
                  id="preparation-command"
                  aria-describedby="preparation-command-help"
                  className="settings-input w-full"
                  value={project.preferences?.prepareCommand ?? ''}
                  placeholder="pnpm install --frozen-lockfile"
                  onChange={(event) =>
                    updateProjectPreferences(project.id, { prepareCommand: event.target.value })
                  }
                />
              </div>
            </div>
          </section>
          <section className="project-preferences-section">
            <h2>Verification</h2>
            <div className="project-workspace-fields">
              <div className="project-preference-field">
                <label htmlFor="verification-command">Verification command</label>
                <p id="verification-command-help" className="settings-row-description">
                  Runs with your OS permissions. Five-minute limit.
                </p>
                <input
                  id="verification-command"
                  aria-describedby="verification-command-help"
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
          <section className="project-preferences-section">
            <Setting
              title="Remove project"
              description="Remove this project from Jackalope. Your files and task history stay intact."
            >
              <RemoveProjectAction
                project={project}
                trigger={<Button variant="outline">Remove from Jackalope…</Button>}
              />
            </Setting>
          </section>
        </>
      )}
    </section>
  );
}
