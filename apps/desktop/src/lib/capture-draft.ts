import type { TaskDraft } from '../stores/executionStore';
import type { Project } from '../stores/projectStore';

export function captureDraftForProject(
  drafts: Record<string, TaskDraft>,
  project: Project,
  previousProjectId: string | null,
): Partial<TaskDraft> {
  const existing = drafts.capture ?? (previousProjectId ? drafts[previousProjectId] : undefined);
  return {
    ...existing,
    projectId: project.id,
    isolated: existing?.isolated ?? project.preferences?.isolatedByDefault ?? true,
    ...((existing?.projectId ?? previousProjectId) !== project.id
      ? { model: undefined, connectionIds: undefined, contextSelection: undefined }
      : {}),
  };
}
