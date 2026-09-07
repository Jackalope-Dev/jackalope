import { useCallback, useEffect, useState } from 'react';
import { useExecutionStore } from '../stores/executionStore';
import { useProjectStore } from '../stores/projectStore';
import { nativeTask } from './task-runtime';
import { isTauriEnvironment } from './tauri-bridge';

export interface KnowledgeEntry {
  id: string;
  projectId: string;
  projectPath: string;
  kind: 'memory' | 'workflow';
  title: string;
  content: string;
  keywords: string[];
  enabled: boolean;
  sourceRunId: string | null;
  revision: number;
  updatedAt: string;
}
export interface ContextSelection {
  workflowId?: string | null;
  excludedMemoryIds?: string[];
  memoryOff?: boolean;
}
export interface ContextReceipt {
  entries: KnowledgeEntry[];
  bytes: number;
}

export function useKnowledge(projectId: string, projectPath: string) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!isTauriEnvironment()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setEntries(await nativeTask<KnowledgeEntry[]>('knowledge_list', { projectId, projectPath }));
      setError('');
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId, projectPath]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { entries, error, loading, refresh };
}

export function openKnowledgeTask(projectId: string, runId: string) {
  useProjectStore.getState().selectProject(projectId);
  useExecutionStore.getState().select(runId);
  window.dispatchEvent(new CustomEvent('jackalope:navigate', { detail: 'kanban' }));
}
