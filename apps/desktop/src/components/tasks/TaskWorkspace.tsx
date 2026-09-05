import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileDiff,
  FolderOpen,
  GitBranch,
  Plus,
  Square,
} from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import {
  isActive,
  nativeTask,
  type Review,
  statusLabel,
  type TaskRun,
} from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { emptyDraft, useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { ProjectQueue } from './ProjectQueue';
import { ProjectSetup } from './ProjectSetup';

const Markdown = lazy(() => import('react-markdown'));

function ResultReview({ run }: { run: TaskRun }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setReview(await nativeTask<Review>('task_review', { id: run.id }));
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="task-review">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-medium">
          <FileDiff size={16} />
          Workspace changes
        </h3>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? 'Reading…' : review ? 'Refresh changes' : 'Inspect changes'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="task-error mt-3">
          {error}
        </p>
      )}
      {review && (
        <div className="mt-4">
          <p className="task-muted text-xs mb-4">{review.note}</p>
          {review.files.length ? (
            <ul className="task-files">
              {review.files.map((file) => (
                <li key={file}>
                  <FileDiff size={13} />
                  <span>{file}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="task-muted">No changed files found.</p>
          )}
          {review.diff && (
            <details className="mt-4">
              <summary className="task-summary">Read patch</summary>
              <pre className="task-output mt-3">{review.diff}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function TaskDetail({ run, onBack }: { run: TaskRun; onBack: () => void }) {
  const { runs, start, submitting, refresh, drafts, draft } = useExecutionStore();
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const key = `reply:${run.taskId}`;
  const reply = drafts[key]?.prompt ?? '';
  const active = isActive(run);
  const attempts = runs.filter((r) => r.taskId === run.taskId);
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
            {runs.filter((r) => r.taskId === run.taskId).at(-1)?.prompt ?? run.prompt}
          </h1>
        </div>
        <span className="task-status" role="status">
          {statusLabel[run.status]}
        </span>
      </div>
      <div className="task-context-line">
        <GitBranch size={13} />
        <span>{run.branch || 'Preparing a place to work'}</span>
        <span>·</span>
        <span>{run.model || 'Agent-configured model'}</span>
      </div>
      {run.workspace && <p className="task-path">{run.workspace}</p>}
      {attempts.length > 1 && (
        <label className="task-attempt-picker">
          Attempt
          <select
            value={run.id}
            onChange={(event) => useExecutionStore.getState().select(event.target.value)}
          >
            {attempts.map((attempt, index) => (
              <option key={attempt.id} value={attempt.id}>
                {attempts.length - index} · {statusLabel[attempt.status]}
              </option>
            ))}
          </select>
        </label>
      )}
      {attempts.length > 1 && (
        <div className="task-request">
          <p className="task-label mb-2">This instruction</p>
          <p>{run.prompt}</p>
        </div>
      )}
      {run.persistenceError && (
        <p role="alert" className="task-error">
          {run.persistenceError}
        </p>
      )}
      {run.error && (
        <p role="alert" className="task-error">
          {run.error}
        </p>
      )}
      <div className="task-result">
        {active && (
          <div className="flex items-start justify-between gap-5 mb-5">
            <div>
              <h2 className="text-lg font-medium">
                {run.status === 'starting'
                  ? 'Preparing your workspace'
                  : run.status === 'stopping'
                    ? 'Stopping this attempt'
                    : 'Your task is underway.'}
              </h2>
              <p className="task-muted mt-2">
                You can move between projects and come back here. Activity and results stay with
                this task.
              </p>
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
        {run.activity.length > 0 && (
          <details className="mt-5">
            <summary className="task-summary">
              Activity <span className="task-muted">· recent {run.activity.length} entries</span>
            </summary>
            <pre className="task-output mt-3">{run.activity.join('\n\n')}</pre>
          </details>
        )}
        {run.diagnostics?.length > 0 && (
          <details className="mt-4">
            <summary className="task-summary">Agent diagnostics</summary>
            <pre className="task-output mt-3">{run.diagnostics.join('\n\n')}</pre>
          </details>
        )}
      </div>
      {!active && run.workspace && <ResultReview key={run.id} run={run} />}
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
            <h2 className="text-lg font-medium">What comes next?</h2>
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

export function TaskWorkspace() {
  const { projects, activeProjectId } = useProjectStore();
  const {
    runs,
    runners,
    selectedId,
    select,
    drafts,
    draft,
    start,
    submitting,
    loading,
    error,
    discover,
    discovering,
  } = useExecutionStore();
  const project = projects.find((p) => p.id === activeProjectId);
  const [setup, setSetup] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [filter, setFilter] = useState('all');
  const [parallel, setParallel] = useState(false);
  const key = project?.id ?? 'projectless';
  const current = drafts[key] ?? emptyDraft;
  const selected = runs.find((run) => run.id === selectedId && run.projectId === project?.id);
  const latest = runs.filter(
    (run, index) =>
      run.projectId === project?.id && runs.findIndex((r) => r.taskId === run.taskId) === index,
  );
  const filtered = latest.filter(
    (run) => filter === 'all' || (filter === 'active' ? isActive(run) : run.status === 'review'),
  );
  const runner = runners.find((r) => r.id === current.agent);
  const desktop = isTauriEnvironment();
  const launch = async () => {
    if (!project || !current.prompt.trim()) return;
    setSubmitError('');
    try {
      await start({
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agent: current.agent,
        prompt: current.prompt.trim(),
        isolated: current.isolated,
      });
      draft(key, { prompt: '' });
    } catch (error) {
      setSubmitError(String(error));
    }
  };
  if (selected) return <TaskDetail key={selected.id} run={selected} onBack={() => select(null)} />;
  if (parallel && project)
    return <ProjectQueue key={project.id} project={project} onBack={() => setParallel(false)} />;
  return (
    <section className="task-page task-home">
      {project && (
        <button type="button" className="task-link float-right" onClick={() => setParallel(true)}>
          Plan parallel work
          <ArrowRight size={15} />
        </button>
      )}
      <div className="task-introduction">
        <p className="task-eyebrow">
          {project ? `A little momentum for ${project.name}` : 'A place for your next idea'}
        </p>
        <h1 className="task-hero-title">
          What do you want
          <br />
          to accomplish?
        </h1>
        <p className="task-muted mt-4">Bring the intent. Keep the context. Follow the work.</p>
      </div>
      {!project ? (
        <div className="task-first-project">
          <FolderOpen size={24} className="text-[var(--color-accent-ink)]" />
          <div>
            <h2 className="font-medium">Start with a project</h2>
            <p className="task-muted mt-1">
              Open a repository, then give your agent something useful to do.
            </p>
          </div>
          <Button onClick={() => setSetup(true)}>
            Choose a folder
            <ArrowRight size={15} />
          </Button>
        </div>
      ) : (
        <form
          className="task-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void launch();
          }}
        >
          <label htmlFor="task-intent" className="sr-only">
            What do you want to accomplish?
          </label>
          <textarea
            id="task-intent"
            value={current.prompt}
            onChange={(event) => draft(key, { prompt: event.target.value })}
            placeholder="Describe a change, investigate a problem, or explore an idea…"
            rows={4}
            maxLength={24000}
            onKeyDown={(event) => {
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing &&
                runner?.available &&
                !submitting &&
                current.prompt.trim() &&
                desktop
              ) {
                event.preventDefault();
                void launch();
              }
            }}
          />
          <div className="task-composer-footer">
            <div className="task-context-controls">
              <span className="task-context-chip">
                <FolderOpen size={13} />
                {project.name}
              </span>
              <label className="task-context-chip">
                <span className="sr-only">Agent</span>
                <select
                  value={current.agent}
                  onChange={(event) => draft(key, { agent: event.target.value })}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                  <option value="grok">Grok</option>
                </select>
              </label>
              <label className="task-context-chip">
                <span className="sr-only">Execution location</span>
                <GitBranch size={13} />
                <select
                  value={current.isolated ? 'isolated' : 'current'}
                  onChange={(event) => draft(key, { isolated: event.target.value === 'isolated' })}
                >
                  <option value="isolated">New worktree</option>
                  <option value="current">Current checkout</option>
                </select>
              </label>
            </div>
            <Button
              type="submit"
              disabled={!desktop || !current.prompt.trim() || !runner?.available || submitting}
            >
              {submitting ? 'Starting…' : 'Start task'}
              <ArrowRight size={15} />
            </Button>
          </div>
          <p className="task-composer-note">
            {current.isolated
              ? 'Starts from the latest local commit; uncommitted changes stay in your checkout.'
              : 'Works directly in this checkout, including existing changes.'}{' '}
            {runner?.available
              ? runner.signedIn
                ? 'Uses your existing sign-in.'
                : 'Sign-in will be checked by the agent when it starts.'
              : 'This agent is not available yet.'}
          </p>
        </form>
      )}
      {!desktop && (
        <p className="task-notice mt-5">
          Browser preview · open the desktop app to select a real repository and execute tasks.
        </p>
      )}
      {desktop && project && !runner?.available && (
        <div className="task-notice mt-5">
          <span>
            {discovering
              ? 'Checking your installed agents…'
              : (runner?.detail ?? 'Refresh to discover installed agents.')}
          </span>
          <button
            type="button"
            className="task-link"
            disabled={discovering}
            onClick={() => void discover()}
          >
            Refresh agents
          </button>
        </div>
      )}
      {(submitError || error) && (
        <p role="alert" className="task-error mt-5">
          {submitError || error}
        </p>
      )}
      <div className="task-list-header">
        <h2 className="font-medium">Your work</h2>
        <div className="flex items-center gap-4">
          <label className="task-filter">
            <span className="sr-only">Filter tasks</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All tasks</option>
              <option value="active">In progress</option>
              <option value="review">Ready for review</option>
            </select>
          </label>
          <button
            type="button"
            className="task-link"
            onClick={() => {
              select(null);
              document.getElementById('task-intent')?.focus();
            }}
          >
            <Plus size={14} />
            New task
          </button>
        </div>
      </div>
      {loading ? (
        <p role="status" className="task-muted py-5">
          Loading task history…
        </p>
      ) : filtered.length ? (
        <div className="task-list">
          {filtered.map((run) => (
            <button
              type="button"
              className="task-list-row"
              key={run.id}
              onClick={() => select(run.id)}
            >
              <div className="min-w-0">
                <span className="block truncate font-medium">
                  {runs.filter((r) => r.taskId === run.taskId).at(-1)?.prompt ?? run.prompt}
                </span>
                <span className="task-muted text-xs mt-2 block">
                  {run.agent} · {new Date(run.startedAt).toLocaleDateString()} ·{' '}
                  {run.usage.reported
                    ? `${(run.usage.input + run.usage.output).toLocaleString()} tokens this attempt`
                    : 'Usage not reported'}
                </span>
              </div>
              <span className="task-status">{statusLabel[run.status]}</span>
              <ChevronRight size={15} className="text-[var(--color-text-muted)]" />
            </button>
          ))}
        </div>
      ) : (
        <p className="task-muted py-7">
          {filter === 'all'
            ? 'Your tasks will stay here, from the first instruction to the final review.'
            : 'No tasks in this state.'}
        </p>
      )}
      <ProjectSetup open={setup} onClose={() => setSetup(false)} />
    </section>
  );
}
