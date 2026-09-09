import { syncAgentConfig } from '../stores/agentConfigStore';
import { useContextMemoryStore } from '../stores/contextMemoryStore';
import { type Project, useProjectStore } from '../stores/projectStore';
import { nativeTask } from './task-runtime';

interface ProjectInfo {
  path: string;
  name: string;
  branch: string;
}

export async function openProject(path: string) {
  await syncAgentConfig();
  const info = await nativeTask<ProjectInfo>('task_validate_project', { path: path.trim() });
  return registerProject(info);
}

export async function createProject(name: string, parentPath: string | null) {
  await syncAgentConfig();
  const info = await nativeTask<ProjectInfo>('task_create_project', {
    name: name.trim(),
    parentPath,
  });
  return registerProject(info);
}

async function registerProject(info: ProjectInfo) {
  const store = useProjectStore.getState();
  const normalize = (value: string) => value.replaceAll('\\', '/').toLowerCase();
  const existing = store.projects.find(
    (project) => normalize(project.path) === normalize(info.path),
  );
  const project: Omit<Project, 'worktrees'> = existing ?? {
    id: crypto.randomUUID(),
    name: info.name,
    path: info.path,
    gitBranch: info.branch || 'Detached HEAD',
    agentProvider: 'codex' as const,
  };
  if (existing) store.selectProject(existing.id);
  else await store.addProject(project);
  void useContextMemoryStore
    .getState()
    .refreshMemory(project)
    .catch(() => {});
  return project;
}
