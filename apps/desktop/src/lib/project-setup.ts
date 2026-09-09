import { syncAgentConfig } from '../stores/agentConfigStore';
import { useContextMemoryStore } from '../stores/contextMemoryStore';
import { useExecutionStore } from '../stores/executionStore';
import { type Project, projectPathKey, useProjectStore } from '../stores/projectStore';
import { captureDraftForProject } from './capture-draft';
import { nativeTask } from './task-runtime';

interface ProjectInfo {
  path: string;
  name: string;
  branch: string;
}

export async function openProject(
  path: string,
  options: { provisional?: boolean; pending?: Project | null } = {},
) {
  await syncAgentConfig();
  const info = await nativeTask<ProjectInfo>('task_validate_project', { path: path.trim() });
  const project = projectFromInfo(info, options.pending);
  return options.provisional ? project : commitProjectSetup(project);
}

export async function createProject(
  name: string,
  parentPath: string | null,
  options: { provisional?: boolean } = {},
) {
  await syncAgentConfig();
  const info = await nativeTask<ProjectInfo>('task_create_project', {
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
  return existing
    ? { ...existing, worktrees: [] }
    : {
        id: crypto.randomUUID(),
        name: info.name,
        path: info.path,
        gitBranch: info.branch || 'Detached HEAD',
        agentProvider: 'codex' as const,
        worktrees: [],
      };
}

export function commitProjectSetup(pending: Project): Project {
  const previousProjectId = useProjectStore.getState().activeProjectId;
  const project = useProjectStore.getState().completeSetup(pending);
  const execution = useExecutionStore.getState();
  if (execution.drafts.capture) {
    execution.draft(
      'capture',
      captureDraftForProject(execution.drafts, project, previousProjectId),
    );
  }
  void useContextMemoryStore
    .getState()
    .refreshMemory(project)
    .catch(() => {});
  return project;
}
