import type { TaskDraft } from '../stores/executionStore';
import type { Project } from '../stores/projectStore';
import { workspaceModeFor } from './workspace-mode.ts';

export function captureDraftForProject(
  drafts: Record<string, TaskDraft>,
  project: Project,
  previousProjectId: string | null,
): Partial<TaskDraft> {
  const existing = drafts.capture ?? (previousProjectId ? drafts[previousProjectId] : undefined);
  return {
    ...existing,
    projectId: project.id,
    isolated: existing?.isolated ?? workspaceModeFor(project) === 'worktree',
    ...((existing?.projectId ?? previousProjectId) !== project.id
      ? { model: undefined, connectionIds: undefined, contextSelection: undefined }
      : {}),
  };
}
