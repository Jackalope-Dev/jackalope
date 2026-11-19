import { GENERAL_PROJECT_ID, type Project, useProjectStore } from '../stores/projectStore';
import { invokeNative } from './native/transport';
import { selectWork } from './work-selection';

/**
 * Focuses the General project, adding it the first time. Its folder lives in Jackalope's
 * data directory and is never a Git repository, so its work needs no worktree, preparation
 * or checks.
 */
export async function openGeneralProject(): Promise<Project> {
  const store = useProjectStore.getState();
  let project = store.projects.find((item) => item.id === GENERAL_PROJECT_ID);
  if (!project) {
    const path = await invokeNative<string>('project_general_folder', {});
    project = {
      id: GENERAL_PROJECT_ID,
      name: 'General',
      path,
      gitBranch: '',
      plainFolder: true,
      worktrees: [],
    };
    const added = project;
    useProjectStore.setState((state) =>
      state.projects.some((item) => item.id === GENERAL_PROJECT_ID)
        ? {}
        : { projects: [...state.projects, added] },
    );
  }
  selectWork();
  useProjectStore.getState().selectProject(GENERAL_PROJECT_ID);
  return project;
}
