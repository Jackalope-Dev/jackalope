import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useShallow } from 'zustand/react/shallow';
import { VETTED_SKILLS } from '../../lib/skills/catalog';
import { useProjectStore } from '../../stores/projectStore';
import { openProjectSettings } from '../layout/navigation';
import { Setting, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { FormField } from '../ui/FormField';
import { Input } from '../ui/input';
import { Switch } from '../ui/Switch';
import { Textarea } from '../ui/Textarea';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { ArtifactsProjectSettings } from './ArtifactsProjectSettings';
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
  const { projects, activeProjectId, updateProject, updateProjectPreferences } = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      updateProject: s.updateProject,
      updateProjectPreferences: s.updateProjectPreferences,
    })),
  );
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
          <SettingGroup>
            <Setting title="Project name" controlId="project-name">
              <Input
                id="project-name"
                className="project-setting-input"
                value={project.name}
                onChange={(e) => updateProject(project.id, { name: e.target.value })}
              />
            </Setting>
            {!embedded && (
              <>
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
                <Setting title="Agents and accounts">
                  <Button
                    variant="outline"
                    onClick={() => openProjectSettings(project.id, 'Agents')}
                  >
                    Configure agents
                  </Button>
                </Setting>
              </>
            )}
          </SettingGroup>
          <SettingGroup title="Tasks">
            <SettingBody>
              <FormField
                label="Project instructions"
                description="Appended to prompts launched from the task composer."
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
            </SettingBody>
            <Setting
              title="Split work into subtasks"
              description="Plan substantial requests as parallel subtasks that start without a review step. Requires a verification command."
            >
              <Switch
                label="Split work into subtasks"
                checked={project.preferences?.automaticSubtasks !== false}
                onCheckedChange={(automaticSubtasks) =>
                  updateProjectPreferences(project.id, { automaticSubtasks })
                }
              />
            </Setting>
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
            <Disclosure className="project-guidelines">
              <DisclosureSummary>Always include guidelines</DisclosureSummary>
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
          </SettingGroup>
          <ProjectGitSettings key={project.path} projectPath={project.path} />
          {!project.plainFolder && (
            <ArtifactsProjectSettings
              key={`artifacts-${project.path}`}
              projectPath={project.path}
              projectName={project.name}
            />
          )}
          <SettingGroup title="Workspace">
            <Setting
              title="Target branch"
              description="Starting branch for new tasks and their review."
              controlId="project-base-branch"
              descriptionId="project-base-branch-description"
            >
              <Input
                id="project-base-branch"
                aria-describedby="project-base-branch-description"
                className="project-setting-input"
                value={project.preferences?.baseBranch ?? ''}
                placeholder={project.gitBranch}
                onChange={(e) =>
                  updateProjectPreferences(project.id, { baseBranch: e.target.value })
                }
              />
            </Setting>
            <Setting
              title="Workspace preparation"
              description="Runs before new tasks, with your OS permissions. Five-minute limit; skipped for continuations."
              controlId="preparation-command"
              descriptionId="preparation-command-description"
            >
              <Input
                id="preparation-command"
                aria-describedby="preparation-command-description"
                className="project-setting-input"
                value={project.preferences?.prepareCommand ?? ''}
                placeholder="pnpm install --frozen-lockfile"
                onChange={(event) =>
                  updateProjectPreferences(project.id, { prepareCommand: event.target.value })
                }
              />
            </Setting>
            <SettingBody>
              <FormField
                label="Copy ignored setup files"
                description="One relative file per line. Only these Git-ignored files are copied into new worktrees before preparation; existing files are never overwritten. Keep credentials out of saved prompts and commands."
              >
                <Textarea
                  rows={3}
                  placeholder=".env.local"
                  value={(project.preferences?.setupFiles ?? []).join('\n')}
                  onChange={(event) =>
                    updateProjectPreferences(project.id, {
                      setupFiles: event.target.value.split('\n'),
                    })
                  }
                />
              </FormField>
            </SettingBody>
          </SettingGroup>
          <SettingGroup title="Checks and preview">
            <Setting
              title="Verification command"
              description="Runs with your OS permissions. Five-minute limit."
              controlId="verification-command"
              descriptionId="verification-command-description"
            >
              <Input
                id="verification-command"
                aria-describedby="verification-command-description"
                className="project-setting-input"
                value={project.preferences?.verifyCommand ?? ''}
                placeholder="pnpm build"
                onChange={(e) =>
                  updateProjectPreferences(project.id, {
                    verifyCommand: e.target.value,
                  })
                }
              />
            </Setting>
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
            <Setting
              title="Preview command"
              description={
                <>
                  Runs only when you choose Start preview. Use {'{port}'} for an available local
                  port.
                </>
              }
              controlId="project-preview-command"
              descriptionId="project-preview-command-description"
            >
              <Input
                id="project-preview-command"
                aria-describedby="project-preview-command-description"
                className="project-setting-input"
                value={project.preferences?.previewCommand ?? ''}
                maxLength={4000}
                placeholder="pnpm run dev -- --port {port} --host 127.0.0.1"
                onChange={(event) =>
                  updateProjectPreferences(project.id, { previewCommand: event.target.value })
                }
              />
            </Setting>
          </SettingGroup>
          <SettingGroup tone="danger">
            <Setting
              title="Remove project"
              description="Remove this project from Jackalope. Your files and task history stay intact."
            >
              <RemoveProjectAction
                project={project}
                trigger={<Button variant="outline">Remove from Jackalope…</Button>}
              />
            </Setting>
          </SettingGroup>
        </>
      )}
    </Container>
  );
}
