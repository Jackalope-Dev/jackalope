import { ArrowLeft, ArrowRight, CalendarClock, Check, Copy, GitMerge, Square } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { waitForStoppedAttempt } from '../../lib/continue-task';
import { isActive, nativeTask, statusLabel, type TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { latestAttempt, safeResultLink } from '../../lib/task-workflow';
import { isTauriEnvironment, listMcpServers, type McpServerConfig } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { TaskLearning } from '../knowledge/TaskLearning';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { ResultReview } from './ResultReview';
import { RunStatus } from './RunStatus';
import { ScreenshotPreview } from './ScreenshotPreview';
import { TaskActivity } from './TaskActivity';
import { TaskIntegration } from './TaskIntegration';
import { TaskSaveRecovery } from './TaskSaveRecovery';
import { TaskTools } from './TaskTools';
import { UserPromptCard } from './UserPromptCard';
import { ValidationJourney } from './ValidationJourney';

const Markdown = lazy(() => import('react-markdown'));

export function TaskDetail({
  run,
  onBack,
  onSchedule,
  onCapture,
  integrated: alreadyIntegrated = false,
}: {
  integrated?: boolean;
  run: TaskRun;
  onBack: () => void;
  onSchedule: () => void;
  onCapture: (ideaId?: string) => void;
}) {
  const { runs, start, submitting, refresh, drafts, draft } = useExecutionStore();
  useEffect(() => {
    if (!run.detailsOmitted) document.getElementById('task-heading')?.focus();
  }, [run.detailsOmitted]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState(false);
  const [tab, setTab] = useState('result');
  const [integrating, setIntegrating] = useState(false);
  const [appliedHere, setIntegrated] = useState(false);
  const integrated = alreadyIntegrated || appliedHere;
  const [imageAttempt, setImageAttempt] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [connections, setConnections] = useState<McpServerConfig[] | null>(null);
  const applied = useCallback(() => setIntegrated(true), []);
  const key = `reply:${run.taskId}`;
  const reply = drafts[key]?.prompt ?? '';
  const active = isActive(run);
  const attempts = runs
    .filter((r) => r.taskId === run.taskId)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const latest = latestAttempt(runs, run.taskId);
  const isLatest = latest?.id === run.id;
  const sourceIdea = useTaskStore((state) =>
    state.tasks.find(
      (idea) =>
        idea.projectId === run.projectId && attempts.some((attempt) => attempt.id === idea.runId),
    ),
  );
  const title = sourceIdea?.title ?? taskTitle(attempts[0]?.prompt ?? run.prompt);
  const pending = run.prompts?.filter((p) => p.status === 'pending') ?? [];
  const isolated =
    !!run.workspace &&
    run.workspace.replaceAll('\\', '/').toLowerCase() !==
      run.projectPath.replaceAll('\\', '/').toLowerCase();
  const finished = !active && ['review', 'reviewed'].includes(run.status);
  const canContinue = isLatest && !!run.sessionId && run.status !== 'interrupted' && !integrated;
  const act = async (command: string) => {
    if (acting) return;
    setActing(true);
    setError('');
    try {
      await nativeTask(command, { id: run.id });
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setActing(false);
    }
  };
  const continueTask = async () => {
    if (!reply.trim() || acting || submitting || !canContinue) return;
    setActing(true);
    setError('');
    const prompt = reply.trim();
    try {
      if (active) {
        await nativeTask('task_stop', { id: run.id });
        await waitForStoppedAttempt(
          run.id,
          async () => {
            await refresh();
            return useExecutionStore.getState().runs.find((r) => r.id === run.id);
          },
          () => new Promise((resolve) => setTimeout(resolve, 250)),
        );
      }
      if (latestAttempt(useExecutionStore.getState().runs, run.taskId)?.id !== run.id)
        throw new Error('A newer attempt exists. Open the latest result before continuing.');
      await start({
        projectId: run.projectId,
        projectName: run.projectName,
        projectPath: run.projectPath,
        agent: run.agent,
        prompt,
        isolated: false,
        previousRunId: run.id,
        connectionIds: drafts[key]?.connectionIds,
      });
      if (useExecutionStore.getState().drafts[key]?.prompt.trim() === prompt)
        draft(key, { prompt: '' });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setActing(false);
    }
  };
  const openLink = async (href: string) => {
    try {
      if (isTauriEnvironment()) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(href);
      } else window.open(href, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(String(cause));
    }
  };
  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(run.result);
      setNotice('Result copied.');
    } catch (cause) {
      setError(`Could not copy the result: ${String(cause)}`);
    }
  };
  const captureRecovery = () => {
    const id = useTaskStore.getState().addTask({
      projectId: run.projectId,
      title: `Continue: ${title}`.slice(0, 160),
      rawPrompt: `Continue this work after inspecting its existing result and workspace.\n\nOriginal instruction:\n${sourceIdea?.rawPrompt ?? attempts[0]?.prompt ?? run.prompt}\n\nPrevious result:\n${run.result.slice(0, 8000)}\n\nWorkspace to inspect: ${run.workspace}\n\nRequested next step:\n${reply}`,
      assignedAgent: run.agent,
      status: 'backlog',
    });
    onCapture(id);
  };
  if (run.detailsOmitted)
    return (
      <section className="task-page" aria-busy="true">
        <button type="button" className="task-back" onClick={onBack}>
          All tasks
        </button>
        <p role="status">Loading this result…</p>
      </section>
    );
  return (
    <section className="task-page task-detail">
      <button type="button" className="task-back" onClick={onBack}>
        <ArrowLeft size={15} />
        All tasks
      </button>
      <div className="task-detail-heading">
        <div>
          <p className="task-eyebrow">
            {run.projectName} · {run.accountBinding?.label || run.account}
          </p>
          <h1 id="task-heading" tabIndex={-1} className="task-title task-prompt-title">
            {title}
          </h1>
        </div>
        <div role="status">
          {run.finishing ? (
            <span className="task-status">Checking result</span>
          ) : (
            <RunStatus status={run.status} />
          )}
        </div>
      </div>
      {!isLatest && latest && (
        <div className="task-notice">
          <span>You’re viewing an earlier attempt.</span>
          <Button variant="ghost" onClick={() => useExecutionStore.getState().select(latest.id)}>
            Open latest result
          </Button>
        </div>
      )}
      <TaskSaveRecovery run={run} />
      {run.error && (
        <p role="alert" className="task-error">
          {run.error}
        </p>
      )}
      {!!pending.length && (
        <div className="space-y-3 mb-5">
          <h2 className="text-base">{active ? 'A decision needs you' : 'Questions left open'}</h2>
          {pending.map((p) => (
            <UserPromptCard
              key={p.id}
              runId={run.id}
              prompt={p}
              active={['starting', 'running'].includes(run.status)}
            />
          ))}
        </div>
      )}
      {active && (
        <div className="task-progress-summary">
          <div>
            <h2 className="text-base">
              {run.finishing
                ? 'Preparing a checked result'
                : run.status === 'starting'
                  ? 'Preparing your workspace'
                  : run.status === 'stopping'
                    ? 'Stopping this attempt'
                    : 'Work is underway'}
            </h2>
            <p className="task-muted mt-2">
              {run.finishing
                ? 'Running the verification command saved for this task. You can stop these checks.'
                : pending.length
                  ? 'Answer above to help the agent continue.'
                  : 'Work continues while you use the rest of Jackalope.'}
            </p>
            {!!run.activity.length && (
              <p className="task-latest-activity">{run.activity.at(-1)?.split('\n')[0]}</p>
            )}
          </div>
          <Button
            variant="outline"
            disabled={acting || run.status === 'stopping'}
            onClick={() => void act('task_stop')}
          >
            <Square size={14} />
            Stop
          </Button>
        </div>
      )}
      {finished && isLatest && (
        <div className="result-actions">
          {isolated && !integrated && (
            <Button
              onClick={() => {
                setTab('changes');
                setIntegrating(true);
              }}
            >
              <GitMerge size={16} />
              Review integration
            </Button>
          )}
          {run.status === 'review' && (
            <Button
              variant="outline"
              disabled={acting || !!run.persistenceError}
              onClick={() => void act('task_mark_reviewed')}
            >
              <Check size={16} />
              Mark reviewed
            </Button>
          )}
          <Button variant="ghost" onClick={onSchedule}>
            <CalendarClock size={16} />
            Make recurring
          </Button>
          {!!run.result && (
            <Button variant="ghost" onClick={() => void copyResult()}>
              <Copy size={16} />
              Copy result
            </Button>
          )}
        </div>
      )}
      <nav className="result-tabs" aria-label="Task sections">
        {['result', 'changes', 'evidence', 'activity'].map((value) => (
          <button
            key={value}
            type="button"
            aria-current={tab === value ? 'page' : undefined}
            onClick={() => setTab(value)}
          >
            {value === 'result'
              ? 'Result'
              : value === 'changes'
                ? 'Changes & checks'
                : value === 'evidence'
                  ? 'Evidence'
                  : 'Activity'}
          </button>
        ))}
      </nav>
      <div className="result-canvas">
        {tab === 'result' && (
          <>
            {!!run.screenshots?.length && (
              <figure className="result-preview">
                <ScreenshotPreview
                  key={`${run.screenshots.at(-1)?.id}:${imageAttempt}`}
                  runId={run.id}
                  screenshot={run.screenshots[run.screenshots.length - 1]}
                  onRetry={() => setImageAttempt((n) => n + 1)}
                />
                <figcaption className="task-muted">
                  {run.screenshots.at(-1)?.name} · Recorded by the agent
                </figcaption>
              </figure>
            )}
            {run.result ? (
              <div className="task-result-text">
                <Suspense fallback={<p>{run.result}</p>}>
                  <Markdown
                    skipHtml
                    components={{
                      a: ({ href, children }) => {
                        const safe = safeResultLink(href);
                        return safe ? (
                          <button
                            type="button"
                            className="task-link result-link"
                            onClick={() => void openLink(safe)}
                          >
                            {children}
                          </button>
                        ) : (
                          <span>{children}</span>
                        );
                      },
                    }}
                  >
                    {run.result}
                  </Markdown>
                </Suspense>
              </div>
            ) : (
              <p className="task-muted">
                {active
                  ? 'The result will appear here as the agent reports it.'
                  : 'No final response was recorded. Your workspace and activity are available for inspection.'}
              </p>
            )}
            {finished && (
              <p className="task-result-assurance">
                {run.verification?.result.success && run.verification.tree
                  ? 'Project checks passed for a recorded file snapshot. Changes after that check require verification again.'
                  : run.verificationError
                    ? `Checks need attention: ${run.verificationError}`
                    : run.verification
                      ? 'Project checks need attention. Open Changes & checks before using this result.'
                      : 'No project checks are recorded. Open Changes & checks to verify the result.'}
              </p>
            )}
          </>
        )}
        {((!active && run.workspace) || tab === 'changes') && (
          <div hidden={tab !== 'changes'}>
            {!active && run.workspace ? (
              <ResultReview key={run.id} run={run} />
            ) : (
              <p className="task-muted">
                Changes become available for review after this attempt stops.
              </p>
            )}
            {integrating && finished && isLatest && (
              <TaskIntegration run={run} onApplied={applied} />
            )}
          </div>
        )}
        {tab === 'evidence' &&
          (run.validationSteps?.length || run.screenshots?.length ? (
            <ValidationJourney
              runId={run.id}
              steps={run.validationSteps ?? []}
              screenshots={run.screenshots ?? []}
            />
          ) : (
            <p className="task-muted">No evidence has been recorded for this attempt.</p>
          ))}
        {tab === 'activity' && <TaskActivity entries={run.activity} active={active} />}
      </div>
      <TaskLearning key={`knowledge:${run.id}`} run={run} />
      <details className="supporting-details task-environment">
        <summary>Context, history & usage</summary>
        <p className="task-muted">
          {run.agent} · {run.model || 'Agent-configured model'} · {run.account} · This computer
        </p>
        <p className="task-path">
          {run.workspace || 'Workspace being prepared'} · {run.branch} · Target: {run.targetBranch}
        </p>
        {attempts.length > 1 && (
          <label className="task-attempt-picker" htmlFor="attempt-history">
            Attempt
            <Select
              id="attempt-history"
              aria-label="Attempt history"
              value={run.id}
              onValueChange={(id) => useExecutionStore.getState().select(id)}
            >
              {attempts.map((attempt, index) => (
                <SelectItem key={attempt.id} value={attempt.id}>
                  {index + 1} · {statusLabel[attempt.status]}
                </SelectItem>
              ))}
            </Select>
          </label>
        )}
        <details>
          <summary>Instruction for this attempt</summary>
          <p className="task-request whitespace-pre-wrap">{run.prompt}</p>
        </details>
        {run.prompts
          ?.filter((p) => p.status === 'answered')
          .map((p) => (
            <UserPromptCard key={p.id} runId={run.id} prompt={p} active={false} />
          ))}
        <p className="task-muted mt-3">
          Reported usage:{' '}
          {run.usage.reported
            ? `${(run.usage.input + run.usage.output).toLocaleString()} tokens · ${run.usage.input.toLocaleString()} input · ${run.usage.output.toLocaleString()} output · ${run.usage.cacheRead.toLocaleString()} cached input (included)`
            : 'Unavailable for this attempt'}
        </p>
        {run.mcpUsage && (
          <details className="my-3">
            <summary>
              Tool discovery · {run.mcpUsage.calls} {run.mcpUsage.calls === 1 ? 'call' : 'calls'}
            </summary>
            <p className="task-muted mt-2">
              Searches: {run.mcpUsage.searches} · Catalog tools: {run.mcpUsage.catalogTools} ·
              Failed calls: {run.mcpUsage.failures}
            </p>
            <p className="task-muted">
              {(run.mcpUsage.schemaBytesReturned / 1024).toFixed(1)} KB of tool definitions returned
              across searches. Full catalog: {(run.mcpUsage.catalogBytes / 1024).toFixed(1)} KB.
              These are schema bytes, not billed tokens or measured savings.
            </p>
          </details>
        )}
        {!!run.diagnostics.length && (
          <details>
            <summary>Agent diagnostics</summary>
            <pre className="task-output">{run.diagnostics.join('\n\n')}</pre>
          </details>
        )}
      </details>
      {isLatest && (
        <div className="task-next">
          <h2 className="text-base mb-3">
            {active
              ? 'Have a change in direction?'
              : integrated
                ? 'Continue from the integrated result'
                : 'Keep shaping the result'}
          </h2>
          {canContinue ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void continueTask();
              }}
            >
              <label htmlFor="task-reply" className="task-label">
                {active
                  ? 'Save a follow-up, or stop this attempt and send it'
                  : 'What would you like to adjust?'}
              </label>
              <textarea
                id="task-reply"
                className="task-reply"
                rows={3}
                value={reply}
                onChange={(event) => draft(key, { prompt: event.target.value })}
                placeholder="Tell Jackalope what to do next…"
                maxLength={24000}
              />
              <div className="task-followup-footer">
                <p className="task-muted">
                  {active
                    ? 'Sending stops this attempt, then resumes the same agent session with your instruction.'
                    : `Continues with ${run.agent} in the same workspace and account.`}
                </p>
                <Button
                  type="submit"
                  disabled={!reply.trim() || submitting || acting || run.status === 'stopping'}
                >
                  {acting || submitting
                    ? 'Continuing…'
                    : active
                      ? 'Stop and send'
                      : 'Continue task'}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="task-muted mb-3">
                {run.status === 'interrupted'
                  ? 'Inspect the agent session and workspace before starting more work; ownership could not be confirmed after interruption.'
                  : integrated
                    ? 'Start a new task from the updated target branch, with this result attached.'
                    : active
                      ? 'A follow-up becomes available when the agent reports a resumable session.'
                      : 'This attempt has no resumable session. Carry its context into a new task to continue.'}
              </p>
              {!active && run.status !== 'interrupted' && (
                <Button variant="outline" onClick={captureRecovery}>
                  Continue in a new task
                </Button>
              )}
            </>
          )}
          {finished && (
            <p className="task-muted text-xs mt-3">
              Mark reviewed records your decision. Review integration previews the changes before an
              explicit merge; nothing is pushed or cleaned up.
            </p>
          )}
        </div>
      )}
      {isLatest && (
        <details
          className="supporting-details"
          onToggle={(event) => {
            if (event.currentTarget.open && connections === null)
              void listMcpServers(run.projectId)
                .then((servers) =>
                  setConnections(
                    servers.filter(
                      (s) => s.enabled !== false && s.scope === `project:${run.projectId}`,
                    ),
                  ),
                )
                .catch((cause) => setError(String(cause)));
          }}
        >
          <summary>Connections for the next step</summary>
          <p className="task-muted">
            These choices apply when you continue. The active attempt keeps its existing tools and
            account.
          </p>
          {connections?.map((server) => (
            <label key={server.id} className="flex items-center gap-3 min-h-11">
              <input
                type="checkbox"
                checked={(
                  drafts[key]?.connectionIds ??
                  run.connectionIds ??
                  connections.map((s) => s.id)
                ).includes(server.id)}
                onChange={(event) => {
                  const ids =
                    drafts[key]?.connectionIds ?? run.connectionIds ?? connections.map((s) => s.id);
                  draft(key, {
                    connectionIds: event.target.checked
                      ? [...ids, server.id]
                      : ids.filter((id) => id !== server.id),
                  });
                }}
              />
              {server.name}
            </label>
          ))}
          <Button
            variant="ghost"
            onClick={() => {
              useProjectStore.getState().selectProject(run.projectId);
              setToolsOpen(true);
            }}
          >
            Manage task connections
          </Button>
        </details>
      )}
      {toolsOpen && (
        <TaskTools
          onClose={() => {
            setToolsOpen(false);
            void listMcpServers(run.projectId)
              .then((servers) =>
                setConnections(
                  servers.filter(
                    (s) => s.enabled !== false && s.scope === `project:${run.projectId}`,
                  ),
                ),
              )
              .catch((cause) => setError(String(cause)));
          }}
        />
      )}
      {notice && (
        <p role="status" className="task-muted">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
    </section>
  );
}
