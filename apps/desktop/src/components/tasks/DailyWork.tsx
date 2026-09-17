import { useEffect, useMemo } from 'react';
import {
  collectWorkspaceWork,
  matchesWorkFilter,
  type WorkItem,
  workPresence,
} from '../../lib/task-collection';
import { useExecutionStore } from '../../stores/executionStore';
import { useLiveSessionStore } from '../../stores/liveSessionStore';
import { observeManagedTasks, useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { defaultWorkView, useWorkViewStore } from '../../stores/workViewStore';
import { navigateWorkspace } from '../layout/navigation';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function DailyWork() {
  const runs = useExecutionStore((state) => state.runs);
  const historyError = useExecutionStore((state) => state.historyError);
  const { sessions, runs: sessionRuns, error: sessionError } = useLiveSessionStore();
  const ideas = useTaskStore((state) => state.tasks);
  const { queue, error } = useManagedTaskStore();
  const integrated = queue.mergedRunIds;
  useEffect(observeManagedTasks, []);
  const items = useMemo(
    () =>
      collectWorkspaceWork(
        null,
        ideas,
        [...new Map([...runs, ...sessionRuns].map((run) => [run.id, run])).values()],
        sessions,
        integrated,
        false,
        queue,
      ),
    [runs, sessionRuns, sessions, ideas, integrated, queue],
  );
  const needsYou = items.filter((item) => matchesWorkFilter(item, 'attention'));
  const working = items.filter((item) => item.stage === 'working');
  const openInbox = (filter = 'all') => {
    const store = useWorkViewStore.getState();
    store.setScope('all');
    store.setView('all:current', { ...defaultWorkView, filter });
    useExecutionStore.getState().select(null);
    useManagedTaskStore.getState().select(null);
    navigateWorkspace('kanban');
  };
  const open = (item: WorkItem) => {
    useExecutionStore.getState().select(null);
    useManagedTaskStore.getState().select(item.managed?.id ?? null);
    if (item.managed) {
      useProjectStore.getState().selectProject(item.managed.request.projectId);
      navigateWorkspace('kanban');
    } else if (item.session) {
      useProjectStore.getState().selectProject(item.session.request.projectId);
      useLiveSessionStore.getState().select(item.session.id);
      navigateWorkspace('live-sessions');
    } else if (item.run) {
      useProjectStore.getState().selectProject(item.run.projectId);
      useWorkViewStore.getState().open(item.run.id, item.stage === 'review' ? 'changes' : 'result');
      useExecutionStore.getState().select(item.run.id);
      navigateWorkspace('kanban');
    }
  };
  if (!items.length && !historyError && !sessionError && !error) return null;
  return (
    <section className="daily-work" aria-label="Work across all projects">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <h2>Pick up where you left off</h2>
        <Button variant="ghost" onClick={() => openInbox()}>
          All projects
        </Button>
      </div>
      {historyError || sessionError || error ? (
        <InlineNotice>
          {historyError || sessionError || error} Work counts may be incomplete.
        </InlineNotice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => openInbox('attention')}>
          Needs you · {needsYou.length}
        </Button>
        <Button variant="ghost" onClick={() => openInbox('working')}>
          {working.length} in progress
        </Button>
      </div>
      {needsYou.slice(0, 1).map((item) => (
        <button key={item.id} type="button" className="daily-work-row" onClick={() => open(item)}>
          <span>
            <strong>{item.title}</strong>
            <small>{item.run?.projectName ?? item.session?.request.projectName}</small>
          </span>
          <span>{item.stage === 'review' ? 'Review result' : workPresence(item).action}</span>
        </button>
      ))}
    </section>
  );
}
