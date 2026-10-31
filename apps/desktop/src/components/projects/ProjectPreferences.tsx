import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useShallow } from 'zustand/react/shallow';
import { LEARNING_CADENCES, learningSettings } from '../../lib/learning';
import { syncsLessons } from '../../lib/lesson-sync';
import { REVIEW_PAGE_LIMIT, reviewCapturesOn } from '../../lib/review-captures';
import { VETTED_SKILLS } from '../../lib/skills/catalog';
import { type WorkspaceMode, workspaceModeFor } from '../../lib/workspace-mode';
import { useProjectStore } from '../../stores/projectStore';
import { openProjectSettings } from '../layout/navigation';
import { Setting, SettingBody, SettingGroup } from '../settings/Setting';
import { Button } from '../ui/button';
import { FormField } from '../ui/FormField';
import { Input } from '../ui/input';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Textarea } from '../ui/Textarea';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { ArtifactsProjectSettings } from './ArtifactsProjectSettings';
import { BrowserProfileSettings } from './BrowserProfileSettings';
import { DesktopProjectSettings } from './DesktopProjectSettings';
import { FeatureMapSettings } from './FeatureMapSettings';
import { ProjectGitSettings } from './ProjectGitSettings';
import { ProjectPlanningSettings } from './ProjectPlanningSettings';
import { RemoveProjectAction } from './RemoveProjectAction';
import '../settings/settings.css';

const WORKSPACE_MODES: Record<WorkspaceMode, { label: string; description: string }> = {
  worktree: {
    label: 'Isolated worktree',
    description:
      'Each task works in its own worktree and branch. Review and merge when it finishes.',
  },
  branch: {
    label: 'New branch here',
    description:
      'Each task switches this checkout to a new branch for review or a pull request. Requires a clean checkout; one task at a time.',
  },
  current: {
    label: 'Current branch',
    description:
      'Tasks edit this checkout on the target branch, alongside your own changes. One task at a time; there is no merge step.',
  },
  ask: {
    label: 'Ask each time',
    description: 'Each task asks where to work when it starts.',
  },
};

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
            <Setting
              title="Auto-approve agent requests"
              description="Approve routine tool use without asking; each approval is listed in the task's activity. Deleting files, force pushes, deploys, credentials, elevated commands and changes outside the workspace still ask. Codex, Gemini CLI, Grok and Antigravity follow their own CLI rules."
            >
              <Switch
                label="Auto-approve agent requests"
                checked={project.preferences?.autoApprove !== false}
                onCheckedChange={(autoApprove) =>
                  updateProjectPreferences(project.id, { autoApprove })
                }
              />
            </Setting>
            <Setting
              title="Use my Claude Code setup"
              description="Claude Code tasks load your own Claude Code settings, plugins, hooks and MCP servers. Turn off to use only this project's settings and the connections chosen here."
            >
              <Switch
                label="Use my Claude Code setup"
                checked={project.preferences?.personalClaudeSetup !== false}
                onCheckedChange={(personalClaudeSetup) =>
                  updateProjectPreferences(project.id, { personalClaudeSetup })
                }
              />
            </Setting>
            <Setting
              title="Learn automatically"
              description="Save lessons from what you tell agents and from checks that pass, while work runs and when it finishes. New lessons stay on probation until tasks use them; unused ones are archived. Review them under Context."
            >
              <Switch
                label="Learn automatically"
                checked={learningSettings(project).automatic}
                onCheckedChange={(learnAutomatically) =>
                  updateProjectPreferences(project.id, { learnAutomatically })
                }
              />
            </Setting>
            {learningSettings(project).automatic && (
              <Setting
                title="Learn during long tasks"
                description="How often a running task is reviewed for new lessons."
                descriptionId="project-learning-cadence-description"
              >
                <Select
                  aria-label="Learn during long tasks"
                  aria-describedby="project-learning-cadence-description"
                  value={String(learningSettings(project).cadence)}
                  onValueChange={(value) =>
                    updateProjectPreferences(project.id, { learningCadence: Number(value) })
                  }
                >
                  {LEARNING_CADENCES.map((cadence) => (
                    <SelectItem key={cadence} value={String(cadence)}>
                      Every {cadence} tool calls
                    </SelectItem>
                  ))}
                </Select>
              </Setting>
            )}
            <Setting
              title="Reflect with an agent"
              description="When work ends, also ask this project's default agent to suggest lessons from what you wrote. Uses that agent account's quota; each reflection is short and capped. Suggestions pass the same checks as other lessons."
            >
              <Switch
                label="Reflect with an agent"
                checked={project.preferences?.agentReflection === true}
                onCheckedChange={(agentReflection) =>
                  updateProjectPreferences(project.id, { agentReflection })
                }
              />
            </Setting>
            <Setting
              title="Sync learned lessons"
              description="Include this project's learned lessons when lesson sync is on under Settings → Privacy. Turn off to keep them on this computer."
            >
              <Switch
                label="Sync learned lessons"
                checked={syncsLessons(project)}
                onCheckedChange={(syncLessons) =>
                  updateProjectPreferences(project.id, { syncLessons })
                }
              />
            </Setting>
            <Setting
              title="Write lessons to AGENTS.md"
              description="Keep active learned lessons in a marked section of this project's AGENTS.md and in a Claude Code skill, so agents outside Jackalope see them. Nothing is committed for you; turning this off removes them."
            >
              <Switch
                label="Write lessons to AGENTS.md"
                checked={project.preferences?.exportLessons === true}
                onCheckedChange={(exportLessons) =>
                  updateProjectPreferences(project.id, { exportLessons })
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
          <ProjectPlanningSettings key={`planning-${project.id}`} projectId={project.id} />
          <ProjectGitSettings key={project.path} projectPath={project.path} />
          <DesktopProjectSettings key={`desktop-${project.id}`} projectId={project.id} />
          <BrowserProfileSettings
            key={`browser-${project.id}`}
            owner={{ kind: 'project', id: project.id, name: project.name }}
          />
          {!project.plainFolder && (
            <ArtifactsProjectSettings
              key={`artifacts-${project.path}`}
              projectPath={project.path}
              projectName={project.name}
            />
          )}
          <SettingGroup title="Workspace">
            {!project.plainFolder && (
              <Setting
                title="Where tasks work"
                description={WORKSPACE_MODES[workspaceModeFor(project)].description}
                descriptionId="project-workspace-mode-description"
              >
                <Select
                  aria-label="Where tasks work"
                  aria-describedby="project-workspace-mode-description"
                  value={workspaceModeFor(project)}
                  onValueChange={(value) =>
                    updateProjectPreferences(project.id, {
                      workspaceMode: value as WorkspaceMode,
                    })
                  }
                >
                  {(Object.keys(WORKSPACE_MODES) as WorkspaceMode[]).map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {WORKSPACE_MODES[mode].label}
                    </SelectItem>
                  ))}
                </Select>
              </Setting>
            )}
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
              title="Check after each edit"
              description="A fast check Claude Code runs after it edits a file, so it fixes problems straight away. {file} is the edited file. One-minute limit."
              controlId="edit-check"
              descriptionId="edit-check-description"
            >
              <Input
                id="edit-check"
                aria-describedby="edit-check-description"
                className="project-setting-input"
                value={project.preferences?.editCheck ?? ''}
                placeholder="pnpm exec biome check {file}"
                onChange={(e) =>
                  updateProjectPreferences(project.id, {
                    editCheck: e.target.value,
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
                  Runs when you choose Start preview, and briefly for review screenshots. Use{' '}
                  {'{port}'} for an available local port.
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
            <Setting
              title="Capture review screenshots"
              description={
                project.preferences?.previewCommand?.trim()
                  ? 'When work with changes finishes, open the preview in a private, temporary browser and save before and after screenshots for review. Adds up to a few minutes to finishing.'
                  : 'Save a preview command to capture before and after screenshots when work finishes.'
              }
            >
              <Switch
                label="Capture review screenshots"
                checked={reviewCapturesOn(project.preferences)}
                disabled={!project.preferences?.previewCommand?.trim()}
                onCheckedChange={(reviewCaptures) =>
                  updateProjectPreferences(project.id, { reviewCaptures })
                }
              />
            </Setting>
            {reviewCapturesOn(project.preferences) && (
              <>
                <Setting
                  title="Screenshot sizes"
                  description="Narrow adds a phone-width capture of each page."
                  descriptionId="project-review-viewports-description"
                >
                  <Select
                    aria-label="Screenshot sizes"
                    aria-describedby="project-review-viewports-description"
                    value={
                      project.preferences?.reviewViewports?.includes('narrow') ? 'both' : 'desktop'
                    }
                    onValueChange={(value) =>
                      updateProjectPreferences(project.id, {
                        reviewViewports: value === 'both' ? ['desktop', 'narrow'] : ['desktop'],
                      })
                    }
                  >
                    <SelectItem value="desktop">Desktop</SelectItem>
                    <SelectItem value="both">Desktop and narrow</SelectItem>
                  </Select>
                </Setting>
                <SettingBody>
                  <FormField
                    label="Pages to capture"
                    description={`One path per line, such as /settings. Pages named in browser checks and pages the agent opened are added, up to ${REVIEW_PAGE_LIMIT} in all. Empty captures /.`}
                  >
                    <Textarea
                      rows={3}
                      placeholder="/"
                      value={(project.preferences?.reviewPages ?? []).join('\n')}
                      onChange={(event) =>
                        updateProjectPreferences(project.id, {
                          reviewPages: event.target.value.split('\n'),
                        })
                      }
                    />
                  </FormField>
                </SettingBody>
              </>
            )}
          </SettingGroup>
          {reviewCapturesOn(project.preferences) && <FeatureMapSettings project={project} />}
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
