import { useCallback, useEffect, useRef, useState } from 'react';
import { useExecutionStore } from '../stores/executionStore';
import { type Project, useProjectStore } from '../stores/projectStore';
import { type Enforcement, type Lifecycle, lessonCheckDraftKey } from './learning';
import { createReadCache } from './read-cache';
import { nativeTask } from './task-runtime';
import { isTauriEnvironment } from './tauri-bridge';
import { workspaceModeFor } from './workspace-mode';

interface ProcessTemplate {
  outcomes: string[];
  steps: string[];
  inputs: string[];
}
export interface KnowledgeEntry {
  automatic?: {
    kind:
      | 'preference'
      | 'adjustment'
      | 'review'
      | 'repository'
      | 'verification'
      | 'correction'
      | 'clarification'
      | 'insight';
    evidence: string[];
    managed: boolean;
    /** Present on lessons the learning loop wrote. */
    lifecycle?: Lifecycle | null;
    resolution?: {
      runId: string;
      requirementId: string;
      tree: string;
      checkedAt: string;
    } | null;
  } | null;
  dismissed?: boolean;
  /** Something the lesson names that the project no longer has. */
  stale?: string | null;
  /** The repository check that enforces it, from an accepted task. */
  enforced?: Enforcement | null;
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
  /** The lesson a "Make it a check" task enforces. */
  enforcesLessonId?: string | null;
}
export interface ContextReceipt {
  jevPreparation?: JevPreparation | null;
  jevPreparationResult?: Record<string, unknown> | null;
  reasons?: Record<string, string>;
  entries: KnowledgeEntry[];
  bytes: number;
  enforcesLessonId?: string | null;
}

interface JevPreparation {
  state: string | Record<string, unknown> | unknown[];
  questions: Record<
    string,
    | {
        type: 'choice';
        instructions: string | Record<string, unknown> | unknown[];
        criteria: Record<string, unknown>;
      }
    | {
        type: 'score';
        instructions: string | Record<string, unknown> | unknown[];
        criteria: unknown[];
      }
    | {
        type: 'noul';
        instructions: string | Record<string, unknown> | unknown[];
        criteria?: { true?: string; false?: string };
      }
  >;
  sources?: Record<string, { kind: 'file'; path: string; startLine?: number; lines?: number }>;
}

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
    await nativeTask('task_restore_archived', { id: runId });
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
    const prompt = await nativeTask<string>('knowledge_check_draft', {
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
