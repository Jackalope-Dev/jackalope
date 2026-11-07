import { syncAgentConfig } from '../stores/agentConfigStore';
import { useContextMemoryStore } from '../stores/contextMemoryStore';
import { type Project, projectPathKey, useProjectStore } from '../stores/projectStore';
import { missingProjectDefaults } from './context/project-defaults';
import { invokeNative } from './native/transport';

/** A folder the native side checked: its resolved path, name and Git state. */
export interface ProjectInfo {
  path: string;
  name: string;
  branch: string;
  repository: boolean;
}

export const validateProject = (path: string) =>
  invokeNative<ProjectInfo>('task_validate_project', { path });

export async function openProject(
  path: string,
  options: { provisional?: boolean; pending?: Project | null } = {},
) {
  await syncAgentConfig();
  const info = await validateProject(path.trim());
  const project = projectFromInfo(info, options.pending);
  return options.provisional ? project : commitProjectSetup(project);
}

export async function createProject(
  name: string,
  parentPath: string | null,
  options: { provisional?: boolean } = {},
) {
  await syncAgentConfig();
  const info = await invokeNative<ProjectInfo>('task_create_project', {
    name: name.trim(),
    parentPath,
  });
  const project = projectFromInfo(info);
  return options.provisional ? project : commitProjectSetup(project);
}

function projectFromInfo(info: ProjectInfo, pending?: Project | null): Project {
  const store = useProjectStore.getState();
  const existing =
    pending && projectPathKey(pending.path) === projectPathKey(info.path)
      ? pending
      : store.projects.find(
          (project) => projectPathKey(project.path) === projectPathKey(info.path),
        );
  const git = projectGitState(info);
  return existing
    ? { ...existing, ...git, worktrees: [] }
    : {
        id: crypto.randomUUID(),
        name: info.name,
        path: info.path,
        ...git,
        agentProvider: 'codex' as const,
        worktrees: [],
      };
}

export function projectGitState(info: {
  branch: string;
  repository: boolean;
}): Pick<Project, 'gitBranch' | 'plainFolder'> {
  return info.repository
    ? { gitBranch: info.branch || 'Detached HEAD', plainFolder: undefined }
    : { gitBranch: '', plainFolder: true };
}

export function commitProjectSetup(pending: Project): Project {
  let project = useProjectStore.getState().completeSetup(pending);
  const memory = useContextMemoryStore.getState().getMemory(project.id);
  if (memory?.projectPath === project.path) {
    const defaults = missingProjectDefaults(project.preferences, memory.projectDefaults);
    if (Object.keys(defaults).length) {
      project = { ...project, preferences: { ...project.preferences, ...defaults } };
      useProjectStore.getState().updateProjectPreferences(project.id, defaults);
    }
  }
  void useContextMemoryStore
    .getState()
    .refreshMemory(project)
    .catch(() => {});
  return project;
}
