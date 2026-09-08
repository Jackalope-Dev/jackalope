import { useContextMemoryStore } from '../stores/contextMemoryStore';
import { useExecutionStore } from '../stores/executionStore';
import { type Project, useProjectStore } from '../stores/projectStore';
import { prepareCodebase } from './codebase';
import { nativeTask } from './task-runtime';
import { isTauriEnvironment } from './tauri-bridge';

export interface PreparationJob {
  id: string;
  label: string;
  result: Promise<void>;
}

const pending = new Map<string, Promise<void>>();

function job(id: string, label: string, run: () => Promise<unknown>): PreparationJob {
  let result = pending.get(id);
  if (!result) {
    result = Promise.resolve()
      .then(run)
      .then(() => {})
      .finally(() => pending.delete(id));
    pending.set(id, result);
  }
  return { id, label, result };
}

export function prepareWorkspace(project: Project | undefined): PreparationJob[] {
  const jobs = [
    job('history', 'Loading task history', async () => {
      await useExecutionStore.getState().refresh();
      const error = useExecutionStore.getState().historyError;
      if (error) throw new Error(error);
    }),
  ];
  if (!isTauriEnvironment()) return jobs;
  jobs.push(
    job('agents', 'Checking installed agents', async () => {
      await useExecutionStore.getState().discover();
      const error = useExecutionStore.getState().discoveryError;
      if (error) throw new Error(error);
    }),
  );
  if (project) {
    const key = `${project.id}:${project.path}`;
    jobs.push(
      job(`project:${key}`, 'Checking the project folder', async () => {
        const info = await nativeTask<{ branch: string }>('task_validate_project', {
          path: project.path,
        });
        const current = useProjectStore.getState().projects.find((item) => item.id === project.id);
        if (current?.path === project.path)
          useProjectStore
            .getState()
            .updateProject(project.id, { gitBranch: info.branch || 'Detached HEAD' });
      }),
      job(`context:${key}`, 'Reading repository instructions and context', () =>
        useContextMemoryStore.getState().refreshMemory(project, { silent: true }),
      ),
      job(`map:${key}`, 'Building the local codebase map', () => prepareCodebase(project.path)),
    );
  }
  return jobs;
}
