import { useMemo } from 'react';
import { useExecutionStore } from '../stores/executionStore';
import { useLiveSessionStore } from '../stores/liveSessionStore';
import { useManagedTaskStore } from '../stores/managedTaskStore';
import { useProjectStore } from '../stores/projectStore';
import { useTaskStore } from '../stores/taskStore';
import { useWorkViewStore } from '../stores/workViewStore';
import type { TaskRun } from './run-types';
import { collectWorkspaceWork, type WorkItem } from './task-collection';

/**
 * What the Work page shows: one task, one conversation, or one plan with
 * optionally one of its tasks. Each shape keeps its own store for saved-state
 * compatibility, so selection always goes through here and the others clear.
 */
export interface WorkTarget {
  task?: string;
  conversation?: string;
  plan?: string;
}

export function selectWork(target: WorkTarget = {}) {
  useExecutionStore.getState().select(target.task ?? null);
  useLiveSessionStore.getState().select(target.conversation ?? null);
  useManagedTaskStore.getState().select(target.plan ?? null);
}

/** The selection that opens a work-list item; a draft selects nothing. */
export function workTarget(item: WorkItem): WorkTarget {
  if (item.managed) return { plan: item.managed.id };
  if (item.session) return { conversation: item.session.id };
  if (item.run) return { task: item.run.id };
  return {};
}

export function workProjectId(item: WorkItem) {
  return (
    item.run?.projectId ??
    item.session?.request.projectId ??
    item.managed?.request.projectId ??
    item.idea?.projectId
  );
}

/** Opens a work item in the main view and focuses its project. */
export function openWork(item: WorkItem) {
  selectWork(workTarget(item));
  const projectId = workProjectId(item);
  if (projectId) useProjectStore.getState().selectProject(projectId);
}

/** Opens a work item on the Work page; a task opens at `section` of its view. */
export function showWork(item: WorkItem, section?: string) {
  openWork(item);
  if (item.run && !item.session && !item.managed)
    useWorkViewStore.getState().open(item.run.id, section);
}

/** Opens one task run by id, focusing the project it belongs to when it is loaded. */
export function openRun(runId: string) {
  const run = allRuns().find((item) => item.id === runId);
  selectWork({ task: runId });
  if (run) useProjectStore.getState().selectProject(run.projectId);
}

/** Opens a conversation by id, focusing its project when it is loaded. */
export function openConversation(sessionId: string) {
  const session = useLiveSessionStore.getState().sessions.find((item) => item.id === sessionId);
  selectWork({ conversation: sessionId });
  if (session) useProjectStore.getState().selectProject(session.request.projectId);
}

/** Task runs and conversation turns live in separate stores; a run in both is listed once. */
function mergeRuns(runs: TaskRun[], sessionRuns: TaskRun[]) {
  return [...new Map([...runs, ...sessionRuns].map((run) => [run.id, run])).values()];
}

function allRuns() {
  return mergeRuns(useExecutionStore.getState().runs, useLiveSessionStore.getState().runs);
}

export function useAllRuns() {
  const runs = useExecutionStore((state) => state.runs);
  const sessionRuns = useLiveSessionStore((state) => state.runs);
  return useMemo(() => mergeRuns(runs, sessionRuns), [runs, sessionRuns]);
}

export interface WorkFilter {
  /** One project's work, `''` for work without a project, or every project when omitted. */
  projectId?: string | null;
  archived?: boolean;
  /** Leave saved drafts out. */
  withoutDrafts?: boolean;
}

/** The work list every surface reads: sidebar, Work page, tabs, status bar and search. */
export function useWorkspaceWork({
  projectId = null,
  archived = false,
  withoutDrafts = false,
}: WorkFilter = {}) {
  const runs = useAllRuns();
  const sessions = useLiveSessionStore((state) => state.sessions);
  const queue = useManagedTaskStore((state) => state.queue);
  const savedIdeas = useTaskStore((state) => state.tasks);
  const ideas = withoutDrafts ? noIdeas : savedIdeas;
  return useMemo(
    () =>
      collectWorkspaceWork(projectId, ideas, runs, sessions, queue.mergedRunIds, archived, queue),
    [projectId, ideas, runs, sessions, queue, archived],
  );
}

const noIdeas: never[] = [];
