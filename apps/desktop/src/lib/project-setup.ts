import { syncAgentConfig } from '../stores/agentConfigStore';
import { useProjectStore } from '../stores/projectStore';
import { nativeTask } from './task-runtime';

export async function openProject(path: string) {
  await syncAgentConfig();
  const info = await nativeTask<{ path: string; name: string; branch: string }>(
    'task_validate_project',
    { path: path.trim() },
  );
  const store = useProjectStore.getState();
  const normalize = (value: string) => value.replaceAll('\\', '/').toLowerCase();
  const existing = store.projects.find(
    (project) => normalize(project.path) === normalize(info.path),
  );
  const project = existing ?? {
    id: crypto.randomUUID(),
    name: info.name,
    path: info.path,
    gitBranch: info.branch || 'Detached HEAD',
    agentProvider: 'codex' as const,
  };
  if (existing) store.selectProject(existing.id);
  else await store.addProject(project);
  void import('../stores/contextMemoryStore')
    .then(({ useContextMemoryStore }) => useContextMemoryStore.getState().refreshMemory(project))
    .catch(() => {});
  return project;
}
