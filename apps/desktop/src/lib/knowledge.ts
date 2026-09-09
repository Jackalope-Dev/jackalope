import { useCallback, useEffect, useRef, useState } from 'react';
import { useExecutionStore } from '../stores/executionStore';
import { useProjectStore } from '../stores/projectStore';
import { createReadCache } from './read-cache';
import { nativeTask } from './task-runtime';
import { isTauriEnvironment } from './tauri-bridge';

export interface ProcessTemplate {
  outcomes: string[];
  steps: string[];
  inputs: string[];
}
export interface KnowledgeEntry {
  process?: ProcessTemplate;
  id: string;
  projectId: string;
  projectPath: string;
  kind: 'memory' | 'workflow';
  title: string;
  content: string;
  keywords: string[];
  enabled: boolean;
  sourceRunId: string | null;
  sourceHead?: string | null;
  revision: number;
  updatedAt: string;
}
export interface ContextSelection {
  advanceWorkflow?: boolean;
  outcomes?: string[];
  inputValues?: Record<string, string>;
  workflowId?: string | null;
  excludedMemoryIds?: string[];
  memoryOff?: boolean;
}
export interface ContextReceipt {
  entries: KnowledgeEntry[];
  bytes: number;
}

const knowledgeCache = createReadCache<KnowledgeEntry[]>(30_000);

export function useKnowledge(projectId: string, projectPath: string) {
  const key = JSON.stringify([projectId, projectPath]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>(() => knowledgeCache.peek(key) ?? []);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!knowledgeCache.peek(key));
  const request = useRef(0);
  const refresh = useCallback(
    async (force = true) => {
      const version = ++request.current;
      if (!isTauriEnvironment()) {
        setLoading(false);
        return;
      }
      const cached = knowledgeCache.peek(key);
      setEntries(cached ?? []);
      setLoading(!cached);
      try {
        const values = await knowledgeCache.read(
          key,
          () => nativeTask<KnowledgeEntry[]>('knowledge_list', { projectId, projectPath }),
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
    void refresh(false);
    return () => {
      request.current++;
    };
  }, [refresh]);
  return { entries, error, loading, refresh };
}

export function openKnowledgeTask(projectId: string, runId: string) {
  useProjectStore.getState().selectProject(projectId);
  useExecutionStore.getState().select(runId);
  window.dispatchEvent(new CustomEvent('jackalope:navigate', { detail: 'kanban' }));
}
