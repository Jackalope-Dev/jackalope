import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { VETTED_SKILLS } from '../../lib/skills/catalog';
import { useProjectStore } from '../../stores/projectStore';
import { openProjectSettings } from '../layout/navigation';
import { Setting } from '../settings/Setting';
import { Button } from '../ui/button';
import { FormField } from '../ui/FormField';
import { Input } from '../ui/input';
import { Switch } from '../ui/Switch';
import { Textarea } from '../ui/Textarea';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { ProjectGitSettings } from './ProjectGitSettings';
import { RemoveProjectAction } from './RemoveProjectAction';
import '../settings/settings.css';
export function ProjectPreferences({
  embedded = false,
  projectId,
}: {
  embedded?: boolean;
  projectId?: string;
}) {
  const { projects, activeProjectId, updateProject, updateProjectPreferences } = useProjectStore();
  const project = projects.find((p) => p.id === (projectId ?? activeProjectId));
  const Container = embedded ? 'section' : WorkspacePage;
  return (
    <Container className="project-preferences">
      {!embedded && (
        <WorkspaceHeading
          title="Project settings"
          description={project ? `${project.name} · ${project.path}` : undefined}
        />
      )}
      {!project ? (
        <p className="settings-section-subtitle mt-4">
          Open a repository to configure project preferences.
        </p>
      ) : (
        <>
          <div className="project-workspace-fields">
            <FormField label="Project name">
              <Input
                id="project-name"
                value={project.name}
                onChange={(e) => updateProject(project.id, { name: e.target.value })}
              />
            </FormField>
          </div>
          {!embedded && (
            <section className="project-preferences-section project-settings-links">
              <Setting
                title="Appearance"
                description={
                  project.preferences?.theme
                    ? `Project theme: ${project.preferences.theme.name}`
                    : 'Using the app theme.'
                }
              >
                <Button
                  variant="outline"
                  onClick={() => openProjectSettings(project.id, 'Appearance')}
                >
                  Edit appearance
                </Button>
              </Setting>
              <Setting
                title="Agents and accounts"
                description="Choose project defaults and available accounts."
              >
                <Button variant="outline" onClick={() => openProjectSettings(project.id, 'Agents')}>
                  Configure agents
                </Button>
              </Setting>
            </section>
          )}
          <section className="project-preferences-section">
            <WorkspaceSectionHeading title="Task instructions" />
            <div className="project-workspace-fields">
              <FormField
                label="Project instructions"
                description={<>Appended to prompts launched from the task composer.</>}
              >
                <Textarea
                  id="project-instructions"
                  rows={5}
                  value={project.preferences?.customInstructions ?? ''}
                  onChange={(e) =>
                    updateProjectPreferences(project.id, {
                      customInstructions: e.target.value,
                    })
                  }
                />
              </FormField>
            </div>
          </section>
          <section className="project-preferences-section project-task-context">
            <WorkspaceSectionHeading title="Task context" />
            <Setting
              title="Choose guidelines automatically"
              description="Match testing, security, onboarding and other guidance to each new task. Fine-tune the selection under Customize task → Context."
            >
              <Switch
                label="Choose guidelines automatically"
                checked={project.preferences?.automaticTaskContext !== false}
                onCheckedChange={(automaticTaskContext) =>
                  updateProjectPreferences(project.id, { automaticTaskContext })
                }
              />
            </Setting>
            <Disclosure>
              <DisclosureSummary className="min-h-11 cursor-pointer py-3">
                Always include guidelines
              </DisclosureSummary>
              {VETTED_SKILLS.map((skill) => (
                <Setting key={skill.id} title={skill.shortLabel} description={skill.description}>
                  <Switch
                    label={`Always include ${skill.shortLabel}`}
                    checked={project.preferences?.taskGuidelines?.includes(skill.id) ?? false}
                    onCheckedChange={(include) =>
                      updateProjectPreferences(project.id, {
                        taskGuidelines: include
                          ? [...(project.preferences?.taskGuidelines ?? []), skill.id]
                          : project.preferences?.taskGuidelines?.filter((id) => id !== skill.id),
                      })
                    }
                  />
                </Setting>
              ))}
            </Disclosure>
          </section>
          <ProjectGitSettings key={project.path} projectPath={project.path} />
          <section className="project-preferences-section">
            <WorkspaceSectionHeading title="Workspace" />
            <div className="project-workspace-fields">
              <FormField
                label="Target branch"
                description={<>Starting branch for new tasks and their review.</>}
              >
                <Input
                  id="project-base-branch"
                  value={project.preferences?.baseBranch ?? ''}
                  placeholder={project.gitBranch}
                  onChange={(e) =>
                    updateProjectPreferences(project.id, { baseBranch: e.target.value })
                  }
                />
              </FormField>
              <FormField
                label="Workspace preparation"
                description={
                  <>
                    Runs before new tasks, with your OS permissions. Five-minute limit; skipped for
                    continuations.
                  </>
                }
              >
                <Input
                  id="preparation-command"
                  value={project.preferences?.prepareCommand ?? ''}
                  placeholder="pnpm install --frozen-lockfile"
                  onChange={(event) =>
                    updateProjectPreferences(project.id, { prepareCommand: event.target.value })
                  }
                />
              </FormField>
            </div>
          </section>
          <section className="project-preferences-section">
            <WorkspaceSectionHeading title="Checks and preview" />
            <div className="project-workspace-fields">
              <FormField
                label="Verification command"
                description={<>Runs with your OS permissions. Five-minute limit.</>}
              >
                <Input
                  id="verification-command"
                  value={project.preferences?.verifyCommand ?? ''}
                  placeholder="pnpm build"
                  onChange={(e) =>
                    updateProjectPreferences(project.id, {
                      verifyCommand: e.target.value,
                    })
                  }
                />
              </FormField>
              <FormField
                label="Preview command"
                description={
                  <>
                    Runs only when you choose Start preview. Use {'{port}'} for an available local
                    port.
                  </>
                }
              >
                <Input
                  id="project-preview-command"
                  value={project.preferences?.previewCommand ?? ''}
                  maxLength={4000}
                  placeholder="pnpm run dev -- --port {port} --host 127.0.0.1"
                  onChange={(event) =>
                    updateProjectPreferences(project.id, { previewCommand: event.target.value })
                  }
                />
              </FormField>
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
    </Container>
  );
}
