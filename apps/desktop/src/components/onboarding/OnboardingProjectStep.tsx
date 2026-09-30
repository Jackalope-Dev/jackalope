import { Input } from '@jackalope/ui';
import { ArrowRight, FolderOpen, FolderPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createProject, openProject } from '../../lib/project-setup';
import { nativeTask } from '../../lib/task-runtime';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

/** Open an existing repository or create a new project folder. */
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
  const [projectMode, setProjectMode] = useState<'existing' | 'new'>('existing');
  const [projectName, setProjectName] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [defaultDirectory, setDefaultDirectory] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  useEffect(() => {
    if (!desktop || projectMode !== 'new') return;
    void nativeTask<string>('task_project_directory')
      .then((directory) => {
        setDefaultDirectory(directory);
        setDirectoryError('');
      })
      .catch(() => setDirectoryError('Choose a folder for your new project.'));
  }, [desktop, projectMode]);
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
          variant={projectMode === 'new' ? 'primary' : 'outline'}
          aria-pressed={projectMode === 'new'}
          disabled={busy}
          onClick={() => {
            setProjectMode('new');
            clearError();
          }}
        >
          <FolderPlus size={16} />
          Create new project
        </Button>
      </fieldset>
      {!desktop && (
        <InlineNotice>
          Open the desktop app to create or choose a project and discover agents.
        </InlineNotice>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void attempt(async () => {
            const opened =
              projectMode === 'new'
                ? await createProject(projectName, parentPath, { provisional: true })
                : await openProject(path, {
                    provisional: true,
                    pending: pendingProject,
                  });
            setPath(opened.path);
            setProjectMode('existing');
            await onOpened(opened, projectMode === 'new');
          });
        }}
      >
        {projectMode === 'new' ? (
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
              Creates a new folder for your first task, with Git when it is installed.
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
              (projectMode === 'new'
                ? !projectName.trim() || (!parentPath && !defaultDirectory)
                : !path.trim())
            }
            loading={busy}
            loadingLabel={projectMode === 'new' ? 'Creating project…' : 'Checking repository…'}
          >
            {projectMode === 'new' ? 'Create project and continue' : 'Continue with this project'}
            <ArrowRight size={16} />
          </Button>
        </div>
      </form>
    </>
  );
}
