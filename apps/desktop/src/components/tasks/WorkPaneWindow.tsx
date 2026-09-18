import { applyThemeTokens, startThemeClock } from '@jackalope/brand/theme';
import { MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { saveWorkFeedback } from '../../lib/work-feedback';
import { observeExecution, useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { ResultReview } from './ResultReview';
import { TaskPreview } from './TaskPreview';
import { TaskTerminal } from './TaskTerminal';
import './workbench.css';
import '../ui/experience.css';

const TaskMarkdown = lazy(() => import('./TaskMarkdown'));
export default function WorkPaneWindow({ id, pane }: { id: string; pane: string }) {
  const run = useExecutionStore((state) => state.runs.find((run) => run.id === id));
  const historyError = useExecutionStore((state) => state.historyError);
  const loading = useExecutionStore((state) => state.loading);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const appTheme = useThemeStore((state) => state.appTheme);
  const theme = useProjectStore(
    (state) => state.projects.find((project) => project.id === run?.projectId)?.preferences?.theme,
  );
  useEffect(startThemeClock, []);
  useEffect(() => {
    useExecutionStore.getState().select(id);
    return observeExecution();
  }, [id]);
  useEffect(() => {
    applyThemeTokens(theme ?? appTheme);
  }, [theme, appTheme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'jackalope-theme') void useThemeStore.persist.rehydrate();
      if (event.key === 'jackalope-projects') void useProjectStore.persist.rehydrate();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const feedback = async (text: string) => {
    if (!run) throw new Error('Task unavailable');
    saveWorkFeedback(run.taskId, run.id, text);
    setCopied(true);
  };
  return (
    <MotionConfig reducedMotion="user">
      <main className="work-pane-window">
        <header>
          <h1>
            {run?.projectName ?? 'Task'} · {pane === 'changes' ? 'Review' : pane}
          </h1>
          <Button
            variant="outline"
            onClick={() =>
              void nativeTask('task_work_window', { id, pane, action: 'dock' }).catch((cause) =>
                setError(String(cause)),
              )
            }
          >
            Return to task
          </Button>
        </header>
        {(error || historyError) && (
          <InlineNotice tone="error">{error || historyError}</InlineNotice>
        )}
        {copied && (
          <InlineNotice>
            Feedback saved with its source context. Return to the task to add it to your reply
            draft.
          </InlineNotice>
        )}
        {run && !run.detailsOmitted ? (
          <>
            <p className="work-context-path">
              {run.branch} · {run.workspace}
            </p>
            {pane === 'terminal' ? (
              <TaskTerminal run={run} />
            ) : pane === 'preview' ? (
              <TaskPreview run={run} onFeedback={feedback} />
            ) : pane === 'changes' ? (
              <ResultReview run={run} canApprove={false} onCorrect={feedback} />
            ) : (
              <Suspense fallback={<p>{run.result}</p>}>
                <TaskMarkdown
                  active={false}
                  content={run.result || 'No result yet.'}
                  onOpenLink={(url) =>
                    void openExternalUrl(url).catch((cause) => setError(String(cause)))
                  }
                />
              </Suspense>
            )}
          </>
        ) : loading || (run?.detailsOmitted && !historyError) ? (
          <p role="status">Loading task…</p>
        ) : (
          <section className="space-y-3">
            <p role="status">
              {historyError
                ? 'Task details could not be loaded.'
                : 'This task is no longer available in history.'}
            </p>
            <Button variant="outline" onClick={() => void useExecutionStore.getState().refresh()}>
              Reload task
            </Button>
          </section>
        )}
      </main>
    </MotionConfig>
  );
}
