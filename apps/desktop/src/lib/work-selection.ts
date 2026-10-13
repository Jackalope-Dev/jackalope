import { useExecutionStore } from '../stores/executionStore';
import { useLiveSessionStore } from '../stores/liveSessionStore';
import { useManagedTaskStore } from '../stores/managedTaskStore';
import type { WorkItem } from './task-collection';

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
