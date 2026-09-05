import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleCheck,
  Eye,
  FileDiff,
  FolderOpen,
  GitBranch,
  ListTodo,
  Plus,
  Square,
  Wand2,
  Workflow,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { detectSkillsFromPrompt, VETTED_SKILLS } from '../../lib/skills/catalog.ts';
import { assemblePrompt } from '../../lib/skills/context-assembler.ts';
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
import { EmptyState } from '../ui/EmptyState';
import { Select, SelectItem } from '../ui/Select';
import { ProjectQueue } from './ProjectQueue';
import { ProjectSetup } from './ProjectSetup';
import { RunStatus } from './RunStatus';

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
        <div role="status">
          <RunStatus status={run.status} />
        </div>
      </div>
      <div className="task-context-line">
        <GitBranch size={13} />
        <span>{run.branch || 'Preparing a place to work'}</span>
        <span>·</span>
        <span>{run.model || 'Agent-configured model'}</span>
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
  const [composing, setComposing] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  useEffect(() => {
    if (composing) document.getElementById('task-intent')?.focus();
  }, [composing]);
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

  const detectedSkills = useMemo(() => detectSkillsFromPrompt(current.prompt), [current.prompt]);
  const activeSkills = current.skills ?? [];
  const assembled = useMemo(() => {
    return assemblePrompt({
      rawPrompt: current.prompt.trim(),
      selectedSkillIds: activeSkills,
      executionMode: current.isolated ? 'isolated' : 'current',
    });
  }, [current.prompt, activeSkills, current.isolated]);

  const toggleSkill = (skillId: string) => {
    const next = activeSkills.includes(skillId)
      ? activeSkills.filter((id) => id !== skillId)
      : [...activeSkills, skillId];
    draft(key, { skills: next });
  };

  const launch = async () => {
    if (!project || !current.prompt.trim()) return;
    setSubmitError('');
    const finalPrompt = assembled.hasSupplementation
      ? assembled.assembledPrompt
      : current.prompt.trim();
    try {
      await start({
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agent: current.agent,
        prompt: finalPrompt,
        isolated: current.isolated,
      });
      draft(key, { prompt: '', skills: [] });
    } catch (error) {
      setSubmitError(String(error));
    }
  };
  if (selected) return <TaskDetail key={selected.id} run={selected} onBack={() => select(null)} />;
  if (parallel && project)
    return <ProjectQueue key={project.id} project={project} onBack={() => setParallel(false)} />;
  return (
    <section className="task-page task-home">
      <div className="task-introduction workspace-section-heading">
        <div>
          <h1 className="task-hero-title">
            {project ? (latest.length ? 'Tasks' : 'What’s next?') : 'A place to get things done.'}
          </h1>
          <p className="task-muted mt-3">
            {project
              ? latest.length
                ? 'Follow the work. Review what’s ready.'
                : 'Give an agent a clear next step.'
              : 'Your projects and agents, in one place.'}
          </p>
        </div>
        {project && (
          <div className="workspace-actions">
            <Button variant="outline" onClick={() => setParallel(true)}>
              <Workflow size={18} />
              Parallel work
            </Button>
            {latest.length > 0 && (
              <Button
                aria-expanded={composing}
                aria-controls="task-composer"
                onClick={() => setComposing(!composing)}
              >
                <Plus size={18} />
                {composing ? 'Close composer' : 'New task'}
              </Button>
            )}
          </div>
        )}
      </div>
      {!project ? (
        <div>
          <EmptyState
            icon={FolderOpen}
            title="Start with a project"
            description="Choose the repository you want to work on."
            action={
              <Button onClick={() => setSetup(true)}>
                <FolderOpen size={18} />
                Open project
              </Button>
            }
          />
          <ol className="journey-strip" aria-label="How tasks work">
            <li>
              <FolderOpen size={20} aria-hidden="true" />
              Project
            </li>
            <li>
              <Bot size={20} aria-hidden="true" />
              Agent
            </li>
            <li>
              <CircleCheck size={20} aria-hidden="true" />
              Review
            </li>
          </ol>
        </div>
      ) : (
        (!latest.length || composing) && (
          <form
            id="task-composer"
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
            {/* Vetted Skills & Quality Guidelines Bar */}
            <div className="task-skill-bar">
              <span className="task-skill-label">
                <Wand2 size={13} aria-hidden="true" />
                Guidelines:
              </span>
              {VETTED_SKILLS.map((skill) => {
                const isSelected = activeSkills.includes(skill.id);
                const isDetected = detectedSkills.some((d) => d.id === skill.id);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => toggleSkill(skill.id)}
                    className={`task-skill-chip ${isSelected ? 'is-active' : ''} ${isDetected && !isSelected ? 'is-suggested' : ''}`}
                    title={skill.description}
                  >
                    <span>{skill.shortLabel}</span>
                    {isSelected && <Check size={11} className="shrink-0" />}
                  </button>
                );
              })}
              {assembled.hasSupplementation && (
                <button
                  type="button"
                  onClick={() => setShowPromptPreview(!showPromptPreview)}
                  className="task-preview-toggle"
                  title="Inspect the supplemented prompt that will be sent to the agent"
                >
                  <Eye size={12} />
                  <span>{showPromptPreview ? 'Hide preview' : 'Preview prompt'}</span>
                </button>
              )}
            </div>

            {/* Collapsible Prompt Preview */}
            {showPromptPreview && assembled.hasSupplementation && (
              <div className="task-prompt-preview">
                <div className="task-preview-header">
                  <span>
                    Assembled agent prompt preview ({assembled.activeSkillCount} active guidelines)
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPromptPreview(false)}
                    className="task-preview-close"
                  >
                    Close
                  </button>
                </div>
                <pre>{assembled.assembledPrompt}</pre>
              </div>
            )}
            <div className="task-composer-footer">
              <div className="task-context-controls">
                <label htmlFor="taskworkspace-field-2" className="task-context-chip">
                  <Bot size={18} aria-hidden="true" />
                  <span className="sr-only">Agent</span>
                  <Select
                    id="taskworkspace-field-2"
                    aria-label="Agent"
                    value={current.agent}
                    onValueChange={(value) => draft(key, { agent: value })}
                  >
                    <SelectItem value="codex">Codex</SelectItem>
                    <SelectItem value="claude">Claude Code</SelectItem>
                    <SelectItem value="grok">Grok</SelectItem>
                  </Select>
                </label>
                <label htmlFor="taskworkspace-field-3" className="task-context-chip">
                  <span className="sr-only">Execution location</span>
                  <GitBranch size={13} />
                  <Select
                    id="taskworkspace-field-3"
                    aria-label="Execution location"
                    value={current.isolated ? 'isolated' : 'current'}
                    onValueChange={(value) => draft(key, { isolated: value === 'isolated' })}
                  >
                    <SelectItem value="isolated">New worktree</SelectItem>
                    <SelectItem value="current">Current checkout</SelectItem>
                  </Select>
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
                ? 'New branch from your latest commit. Uncommitted changes stay here.'
                : 'Edits this checkout, including existing changes.'}{' '}
              {runner?.available
                ? runner.signedIn
                  ? 'Uses your existing sign-in.'
                  : 'Sign-in will be checked by the agent when it starts.'
                : 'This agent is not available yet.'}
            </p>
          </form>
        )
      )}
      {!desktop && (
        <p className="task-notice mt-5">
          Browser preview · connect projects and run agents in the desktop app.
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
      {project && (
        <div className="task-list-header">
          <h2 className="font-medium">Your work</h2>
          <fieldset className="task-filter-group" aria-label="Filter tasks">
            {[
              ['all', 'All', latest.length],
              ['active', 'Working', latest.filter(isActive).length],
              ['review', 'Review', latest.filter((r) => r.status === 'review').length],
            ].map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(String(value))}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </fieldset>
        </div>
      )}
      {project &&
        (loading ? (
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
                    {runners.find((runner) => runner.id === run.agent)?.name ?? run.agent} ·{' '}
                    {new Date(run.startedAt).toLocaleDateString()}
                  </span>
                </div>
                <RunStatus status={run.status} />
                <ChevronRight size={15} className="text-[var(--color-text-muted)]" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ListTodo}
            title={filter === 'all' ? 'Ready for your first task' : 'Nothing here yet'}
            description={
              filter === 'all'
                ? 'Describe the work above. Results and review will stay with the task.'
                : 'Tasks will appear here as their status changes.'
            }
          />
        ))}
      <ProjectSetup open={setup} onClose={() => setSetup(false)} />
    </section>
  );
}
