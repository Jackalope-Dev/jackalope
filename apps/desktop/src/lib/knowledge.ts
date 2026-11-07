import { useCallback, useEffect, useRef, useState } from 'react';
import { useExecutionStore } from '../stores/executionStore';
import { type Project, useProjectStore } from '../stores/projectStore';
import type { KnowledgeEntry } from './knowledge-types';
import { lessonCheckDraftKey } from './learning';
import { isTauriEnvironment } from './native/env';
import { invokeNative } from './native/transport';
import { createReadCache } from './read-cache';
import { workspaceModeFor } from './workspace-mode';

const knowledgeCache = createReadCache<KnowledgeEntry[]>(30_000);

export function useKnowledge(projectId: string, projectPath: string) {
  const historyVersion = useExecutionStore((state) =>
    state.runs
      .filter((run) => run.projectId === projectId)
      .map(
        (run) =>
          `${run.id}:${run.status}:${run.contract?.requirements.map((item) => item.receipt?.recordedAt).join(',')}`,
      )
      .join('|'),
  );
  const key = JSON.stringify([projectId, projectPath]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>(() => knowledgeCache.peek(key) ?? []);
  const entriesKey = useRef(key);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!knowledgeCache.peek(key));
  const request = useRef(0);
  const refresh = useCallback(
    async (force = true) => {
      const version = ++request.current;
      if (!isTauriEnvironment() || !projectId || !projectPath) {
        setEntries([]);
        setError('');
        setLoading(false);
        return;
      }
      entriesKey.current = key;
      const cached = knowledgeCache.peek(key);
      setEntries(cached ?? []);
      setLoading(!cached);
      try {
        const values = await knowledgeCache.read(
          key,
          () => invokeNative<KnowledgeEntry[]>('knowledge_list', { projectId, projectPath }),
          force,
        );
        if (version !== request.current) return;
        setEntries(values);
        setError('');
      } catch (cause) {
        if (version === request.current) setError(String(cause));
      } finally {
        if (version === request.current) setLoading(false);
      }
    },
    [key, projectId, projectPath],
  );
  useEffect(() => {
    void historyVersion;
    void refresh(true);
    return () => {
      request.current++;
    };
  }, [refresh, historyVersion]);
  return { entries: entriesKey.current === key ? entries : [], error, loading, refresh };
}

export async function openKnowledgeTask(projectId: string, runId: string) {
  if (!useExecutionStore.getState().runs.some((run) => run.id === runId)) {
    await invokeNative('task_restore_archived', { id: runId });
    await useExecutionStore.getState().refresh();
    if (!useExecutionStore.getState().runs.some((run) => run.id === runId))
      throw new Error('The source task could not be loaded. Retry from archived history.');
  }
  useProjectStore.getState().selectProject(projectId);
  useExecutionStore.getState().select(runId);
  window.dispatchEvent(new CustomEvent('jackalope:navigate', { detail: 'kanban' }));
}

/**
 * Opens an editable "Make it a check" task for a lesson in the composer. An
 * unfinished draft for the same lesson is reopened as it was left; nothing
 * starts until the person launches it.
 */
export async function prepareLessonCheck(project: Project, entry: KnowledgeEntry) {
  const key = lessonCheckDraftKey(entry.id);
  const store = useExecutionStore.getState();
  if (!store.drafts[key]) {
    const prompt = await invokeNative<string>('knowledge_check_draft', {
      projectId: project.id,
      projectPath: project.path,
      entryId: entry.id,
    });
    store.draft(key, {
      projectId: project.id,
      title: `Make a check: ${entry.title}`.slice(0, 120),
      prompt,
      agent: '',
      isolated: workspaceModeFor(project) === 'worktree',
      contextSelection: { enforcesLessonId: entry.id },
    });
  }
  window.dispatchEvent(new CustomEvent('jackalope:helper-draft', { detail: key }));
}
