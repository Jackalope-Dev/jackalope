import { Badge, Input, SegmentedControl } from '@jackalope/ui';
import { ArrowRight, FolderOpen, FolderPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type ArtifactsStatus,
  artifactsStatus,
  createArtifactsProject,
  suggestRepoName,
  validRepoName,
} from '../../lib/cloudflare-artifacts';
import { createProject, openProject } from '../../lib/project-setup';
import { nativeTask } from '../../lib/task-runtime';
import type { Project } from '../../stores/projectStore';
import { ArtifactsConnectForm } from '../settings/ArtifactsConnection';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

/** Open an existing repository, or create a new project folder locally or backed by Cloudflare Artifacts. */
export function OnboardingProjectStep({
  initialPath,
  pendingProject,
  desktop,
  busy,
  attempt,
  clearError,
  onOpened,
}: {
  initialPath: string;
  pendingProject: Project | null;
  desktop: boolean;
  busy: boolean;
  attempt: (action: () => Promise<void>) => Promise<void>;
  clearError: () => void;
  /** Called with the provisional project; `created` is true for a new folder. */
  onOpened: (project: Project, created: boolean) => Promise<void>;
}) {
  const [path, setPath] = useState(initialPath);
  const [projectMode, setProjectMode] = useState<'existing' | 'new' | 'artifacts'>('existing');
  const creating = projectMode !== 'existing';
  const [projectName, setProjectName] = useState('');
  const [repoName, setRepoName] = useState('');
  const [repoEdited, setRepoEdited] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactsStatus | null>(null);
  const [pushWarning, setPushWarning] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [defaultDirectory, setDefaultDirectory] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  useEffect(() => {
    if (!desktop || projectMode !== 'artifacts') return;
    void artifactsStatus()
      .then(setArtifacts)
      .catch(() => setArtifacts({ connected: false }));
  }, [desktop, projectMode]);
  useEffect(() => {
    if (!desktop || !creating) return;
    void nativeTask<string>('task_project_directory')
      .then((directory) => {
        setDefaultDirectory(directory);
        setDirectoryError('');
      })
      .catch(() => setDirectoryError('Choose a folder for your new project.'));
  }, [desktop, creating]);
  const effectiveRepoName = repoEdited ? repoName : suggestRepoName(projectName);
  const needsConnection = projectMode === 'artifacts' && !artifacts?.connected;
  return (
    <>
      <fieldset className="onboarding-project-options" aria-label="Project setup">
        <Button
          variant={projectMode === 'existing' ? 'primary' : 'outline'}
          aria-pressed={projectMode === 'existing'}
          disabled={busy}
          onClick={() => {
            setProjectMode('existing');
            clearError();
          }}
        >
          <FolderOpen size={16} />
          Open existing
        </Button>
        <Button
          variant={creating ? 'primary' : 'outline'}
          aria-pressed={creating}
          disabled={busy}
          onClick={() => {
            if (!creating) setProjectMode('new');
            clearError();
          }}
        >
          <FolderPlus size={16} />
          Create new project
        </Button>
      </fieldset>
      {creating && (
        <div className="onboarding-project-storage">
          <span className="task-label" aria-hidden="true">
            Keep it on
          </span>
          <SegmentedControl
            label="Where to keep the new project"
            value={projectMode}
            onChange={(mode) => {
              setProjectMode(mode);
              clearError();
            }}
            items={[
              { id: 'new', label: 'This computer', disabled: busy },
              {
                id: 'artifacts',
                label: (
                  <>
                    Cloudflare Artifacts <Badge variant="accent">Beta</Badge>
                  </>
                ),
                disabled: busy,
              },
            ]}
          />
        </div>
      )}
      {!desktop && (
        <InlineNotice>
          Open the desktop app to create or choose a project and discover agents.
        </InlineNotice>
      )}
      {pushWarning && (
        <InlineNotice tone="warning">
          The project and its Artifacts repository were created, but the first push failed. Use Push
          to Artifacts in Project settings to retry. {pushWarning}
        </InlineNotice>
      )}
      {desktop && needsConnection && artifacts && (
        <>
          <p className="onboarding-note">
            Cloudflare Artifacts stores your project as a Git repository built for many agents
            working at once. Connect your Cloudflare account to continue.
          </p>
          <ArtifactsConnectForm className="space-y-3" disabled={busy} onConnected={setArtifacts} />
        </>
      )}
      <form
        hidden={needsConnection}
        onSubmit={(event) => {
          event.preventDefault();
          void attempt(async () => {
            let opened: Project;
            if (projectMode === 'artifacts') {
              const created = await createArtifactsProject(
                projectName,
                parentPath,
                effectiveRepoName,
                { provisional: true },
              );
              opened = created.project;
              setPushWarning(created.pushError ?? '');
            } else {
              opened =
                projectMode === 'new'
                  ? await createProject(projectName, parentPath, { provisional: true })
                  : await openProject(path, {
                      provisional: true,
                      pending: pendingProject,
                    });
            }
            setPath(opened.path);
            setProjectMode('existing');
            await onOpened(opened, creating);
          });
        }}
      >
        {creating ? (
          <>
            <label className="task-label" htmlFor="onboarding-project-name">
              Project name
            </label>
            <Input
              id="onboarding-project-name"
              className="task-input onboarding-project-name"
              placeholder="My new project"
              maxLength={80}
              required
              value={projectName}
              disabled={!desktop || busy}
              onChange={(event) => setProjectName(event.target.value)}
            />
            {projectMode === 'artifacts' && (
              <>
                <label className="task-label onboarding-repo-label" htmlFor="onboarding-repo-name">
                  Artifacts repository
                </label>
                <Input
                  id="onboarding-repo-name"
                  className="task-input onboarding-project-name"
                  spellCheck={false}
                  maxLength={100}
                  required
                  value={effectiveRepoName}
                  aria-invalid={!!effectiveRepoName && !validRepoName(effectiveRepoName)}
                  disabled={!desktop || busy}
                  onChange={(event) => {
                    setRepoEdited(true);
                    setRepoName(event.target.value);
                  }}
                />
              </>
            )}
            <div className="onboarding-project-location">
              <div>
                <span className="task-label">Create in</span>
                <p>{parentPath ?? (defaultDirectory || 'Documents / Jackalope Projects')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!desktop || busy}
                onClick={() =>
                  void attempt(async () => {
                    const selected = await nativeTask<string | null>('task_pick_project');
                    if (selected) {
                      setParentPath(selected);
                      setDirectoryError('');
                    }
                  })
                }
              >
                Change folder
              </Button>
            </div>
            {directoryError && !parentPath && (
              <InlineNotice tone="error">{directoryError}</InlineNotice>
            )}
            <p className="onboarding-note">
              {projectMode === 'artifacts'
                ? `Creates the repository in the ${artifacts?.namespace ?? ''} namespace and a local folder that pushes to it. Requires Git.`
                : 'Creates a new folder for your first task, with Git when it is installed.'}
            </p>
          </>
        ) : (
          <>
            <label className="task-label" htmlFor="onboarding-path">
              Repository folder
            </label>
            <div className="onboarding-folder">
              <Input
                id="onboarding-path"
                className="task-input"
                placeholder="Paste a repository path"
                value={path}
                required
                disabled={!desktop || busy}
                onChange={(event) => setPath(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!desktop || busy}
                onClick={() =>
                  void attempt(async () => {
                    const selected = await nativeTask<string | null>('task_pick_project');
                    if (selected) setPath(selected);
                  })
                }
              >
                <FolderOpen size={16} />
                Browse
              </Button>
            </div>
          </>
        )}
        <div className="onboarding-actions">
          <Button
            type="submit"
            disabled={
              !desktop ||
              busy ||
              (creating
                ? !projectName.trim() ||
                  (!parentPath && !defaultDirectory) ||
                  (projectMode === 'artifacts' && !validRepoName(effectiveRepoName))
                : !path.trim())
            }
            loading={busy}
            loadingLabel={creating ? 'Creating project…' : 'Checking repository…'}
          >
            {creating ? 'Create project and continue' : 'Continue with this project'}
            <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </>
  );
}
