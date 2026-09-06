import { ArrowLeft, ArrowRight, Check, GitBranch, Square } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { isActive, nativeTask, statusLabel, type TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { useExecutionStore } from '../../stores/executionStore';
import { useTaskStore } from '../../stores/taskStore';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { ResultReview } from './ResultReview';
import { RunStatus } from './RunStatus';
import { TaskActivity } from './TaskActivity';
import { TaskSaveRecovery } from './TaskSaveRecovery';
import { UserPromptCard } from './UserPromptCard';
import { ValidationJourney } from './ValidationJourney';

const Markdown = lazy(() => import('react-markdown'));

export function TaskDetail({ run, onBack }: { run: TaskRun; onBack: () => void }) {
  const { runs, start, submitting, refresh, drafts, draft } = useExecutionStore();
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const key = `reply:${run.taskId}`;
  const reply = drafts[key]?.prompt ?? '';
  const active = isActive(run);
  const attempts = runs.filter((r) => r.taskId === run.taskId);
  const sourceIdea = useTaskStore((state) =>
    state.tasks.find(
      (idea) =>
        idea.projectId === run.projectId && attempts.some((attempt) => attempt.id === idea.runId),
    ),
  );
  const act = async (command: string) => {
    if (acting) return;
    setActing(true);
    setError('');
    try {
      await nativeTask(command, { id: run.id });
      await refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setActing(false);
    }
  };
  const continueTask = async () => {
    setError('');
    try {
      await start({
        projectId: run.projectId,
        projectName: run.projectName,
        projectPath: run.projectPath,
        agent: run.agent,
        prompt: reply.trim(),
        isolated: false,
        previousRunId: run.id,
      });
      draft(key, { prompt: '' });
    } catch (error) {
      setError(String(error));
    }
  };
  if (run.detailsOmitted)
    return (
      <section className="task-page" aria-busy="true">
        <button type="button" className="task-back" onClick={onBack}>
          All tasks
        </button>
        <p role="status">Loading this attempt…</p>
      </section>
    );
  return (
    <section className="task-page task-detail" key={run.id}>
      <button type="button" className="task-back" onClick={onBack}>
        <ArrowLeft size={15} />
        All tasks
      </button>
      <div className="task-detail-heading">
        <div>
          <p className="task-eyebrow">
            {run.projectName} · {run.agent}
          </p>
          <h1 className="task-title task-prompt-title">
            {sourceIdea?.title ?? taskTitle(attempts.at(-1)?.prompt ?? run.prompt)}
          </h1>
        </div>
        <div role="status">
          <RunStatus status={run.status} />
        </div>
      </div>
      <div className="task-context-line">
        <GitBranch size={13} />
        <span>{run.branch || 'Preparing a place to work'}</span>
        <span>·</span>
        <span>{run.model || 'Agent-configured model'}</span>
        <span>· {run.account}</span>
        {run.targetBranch && <span>· Target: {run.targetBranch}</span>}
      </div>
      {run.workspace && <p className="task-path">{run.workspace}</p>}
      {attempts.length > 1 && (
        <label htmlFor="taskworkspace-field-1" className="task-attempt-picker">
          Attempt
          <Select
            id="taskworkspace-field-1"
            aria-label="Attempt"
            value={run.id}
            onValueChange={(value) => useExecutionStore.getState().select(value)}
          >
            {attempts.map((attempt, index) => (
              <SelectItem key={attempt.id} value={attempt.id}>
                {attempts.length - index} · {statusLabel[attempt.status]}
              </SelectItem>
            ))}
          </Select>
        </label>
      )}
      <details className="supporting-details">
        <summary>{attempts.length > 1 ? 'This attempt’s instruction' : 'Task instruction'}</summary>
        <div className="task-request whitespace-pre-wrap [overflow-wrap:anywhere]">
          {run.prompt}
        </div>
      </details>
      <TaskSaveRecovery run={run} />
      {run.error && (
        <p role="alert" className="task-error">
          {run.error}
        </p>
      )}
      {run.prompts && run.prompts.length > 0 && (
        <div className="space-y-3 mb-5">
          {run.prompts.map((p) => (
            <UserPromptCard
              key={p.id}
              runId={run.id}
              prompt={p}
              active={['starting', 'running'].includes(run.status)}
            />
          ))}
        </div>
      )}
      <div className="task-result">
        {active && (
          <div className="flex items-start justify-between gap-5 mb-5">
            <div>
              <h2 className="text-base font-medium">
                {run.status === 'starting'
                  ? 'Preparing your workspace'
                  : run.status === 'stopping'
                    ? 'Stopping this attempt'
                    : 'Your task is underway.'}
              </h2>
              <p className="task-muted mt-2">Work continues while you use the rest of Jackalope.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={acting || run.status === 'stopping'}
              onClick={() => void act('task_stop')}
            >
              <Square size={12} />
              Stop
            </Button>
          </div>
        )}
        {run.result ? (
          <div className="task-result-text">
            <Suspense fallback={<p>{run.result}</p>}>
              <Markdown skipHtml components={{ a: ({ children }) => <span>{children}</span> }}>
                {run.result}
              </Markdown>
            </Suspense>
          </div>
        ) : (
          !active && (
            <p className="task-muted">
              This attempt did not return a result. Review its activity and workspace before
              deciding what to do next.
            </p>
          )
        )}
        <TaskActivity entries={run.activity} active={active} />
        {run.diagnostics?.length > 0 && (
          <details className="mt-4">
            <summary className="task-summary">Agent diagnostics</summary>
            <pre className="task-output mt-3">{run.diagnostics.join('\n\n')}</pre>
          </details>
        )}
      </div>
      {!active && run.workspace && <ResultReview key={run.id} run={run} />}
      {((run.validationSteps && run.validationSteps.length > 0) ||
        (run.screenshots && run.screenshots.length > 0)) && (
        <div className="mt-6">
          <ValidationJourney
            runId={run.id}
            steps={run.validationSteps ?? []}
            screenshots={run.screenshots ?? []}
          />
        </div>
      )}
      <div className="task-usage-line">
        <span>Reported usage</span>
        <span>
          {run.usage.reported
            ? `${(run.usage.input + run.usage.output).toLocaleString()} tokens`
            : active
              ? 'Waiting for agent report'
              : 'Unavailable for this attempt'}
        </span>
      </div>
      {run.usage.reported && (
        <p className="task-muted text-xs mt-1">
          {run.usage.input.toLocaleString()} input · {run.usage.output.toLocaleString()} output ·{' '}
          {run.usage.cacheRead.toLocaleString()} cached input (included in input)
        </p>
      )}
      {!active && (
        <div className="task-next">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="text-base font-medium">What comes next?</h2>
            {run.status === 'review' && (
              <Button
                variant="outline"
                disabled={acting}
                onClick={() => void act('task_mark_reviewed')}
              >
                <Check size={15} />
                Mark reviewed
              </Button>
            )}
            {run.status === 'reviewed' && (
              <span className="task-muted flex items-center gap-2">
                <Check size={15} />
                Reviewed
              </span>
            )}
          </div>
          {run.sessionId && run.status !== 'interrupted' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void continueTask();
              }}
            >
              <label htmlFor="task-reply" className="task-label">
                Answer a question or ask for another iteration
              </label>
              <textarea
                id="task-reply"
                className="task-reply"
                rows={3}
                value={reply}
                onChange={(event) => draft(key, { prompt: event.target.value })}
                placeholder="Tell the agent what to adjust…"
                maxLength={24000}
              />
              <div className="flex justify-between items-center gap-4">
                <p className="task-muted text-xs">
                  Continues with {run.agent} in the same workspace.
                </p>
                <Button
                  type="submit"
                  disabled={!reply.trim() || submitting || attempts.some(isActive)}
                >
                  {submitting ? 'Starting…' : 'Continue task'}
                  <ArrowRight size={14} />
                </Button>
              </div>
            </form>
          ) : (
            <p className="task-muted">
              {run.status === 'interrupted'
                ? 'Inspect the agent’s CLI session and workspace before starting new work. Jackalope cannot confirm ownership of a process interrupted by an unexpected close.'
                : 'The agent did not provide a resumable session. Start a new task with the relevant context.'}
            </p>
          )}
          <p className="task-muted text-xs mt-4">
            Marking reviewed records your review. It does not commit, merge or remove the branch.
            Tool permissions remain controlled by the agent; requests it cannot perform are reported
            in the result.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="task-error mt-5">
          {error}
        </p>
      )}
    </section>
  );
}
