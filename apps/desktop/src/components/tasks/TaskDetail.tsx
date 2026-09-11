import {
  Checkbox,
  DefinitionList,
  Disclosure,
  DisclosureSummary,
  DropdownMenu as Menu,
  Tabs,
  Textarea,
} from '@jackalope/ui';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Copy,
  GitMerge,
  MoreHorizontal,
  Square,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { waitForStoppedAttempt } from '../../lib/continue-task';
import { recoveryHandoff } from '../../lib/project-return';
import {
  canRetry,
  isActive,
  nativeTask,
  retryTask,
  statusLabel,
  type TaskRun,
} from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { latestAttempt } from '../../lib/task-workflow';
import { isTauriEnvironment, listMcpServers, type McpServerConfig } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore } from '../../stores/taskStore';
import { TaskLearning } from '../knowledge/TaskLearning';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { FeedbackTouchpoint } from './FeedbackTouchpoint';
import { ResultReview } from './ResultReview';
import { ScreenshotPreview } from './ScreenshotPreview';
import { TaskActivity } from './TaskActivity';
import { TaskFailure } from './TaskFailure';
import { TaskIntegration } from './TaskIntegration';
import { TaskOutcomes } from './TaskOutcomes';
import { TaskPreview } from './TaskPreview';
import { TaskProgress } from './TaskProgress';
import { TaskSaveRecovery } from './TaskSaveRecovery';
import { UserPromptCard } from './UserPromptCard';
import { ValidationJourney } from './ValidationJourney';
import { WorkspaceReadiness } from './WorkspaceReadiness';
import './task-detail.css';

const TaskMarkdown = lazy(() => import('./TaskMarkdown'));
// The tools panel pulls in the agent, connection and project editors; load it
// only when the user opens it.
const TaskTools = lazy(() => import('./TaskTools').then((m) => ({ default: m.TaskTools })));

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
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!run.detailsOmitted) heading.current?.focus();
  }, [run.detailsOmitted]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState(false);
  const [retrying, setRetrying] = useState(false);
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
  const routing = run.routing;
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
  const currentProject = useProjectStore((s) => s.projects.find((p) => p.id === run.projectId));
  const title = sourceIdea?.title ?? taskTitle(attempts[0]?.prompt ?? run.prompt);
  const pending = run.prompts?.filter((p) => p.status === 'pending') ?? [];
  const isolated =
    !!run.workspace &&
    run.workspace.replaceAll('\\', '/').toLowerCase() !==
      run.projectPath.replaceAll('\\', '/').toLowerCase();
  const finished = !active && ['review', 'reviewed'].includes(run.status);
  const canContinue = isLatest && !!run.sessionId && run.status !== 'interrupted' && !integrated;

  useEffect(() => {
    if (tab !== 'context' || !isLatest || connections !== null) return;
    let alive = true;
    void listMcpServers(run.projectId)
      .then((servers) => {
        if (alive)
          setConnections(
            servers.filter(
              (server) => server.enabled !== false && server.scope === `project:${run.projectId}`,
            ),
          );
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [tab, isLatest, connections, run.projectId]);
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
  /** Start a fresh attempt at this task and follow it. */
  const retry = async () => {
    if (retrying || submitting) return;
    setRetrying(true);
    setError('');
    try {
      const id = await retryTask(run.id);
      await refresh();
      useExecutionStore.getState().select(id);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRetrying(false);
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
  const openLink = useCallback(async (href: string) => {
    try {
      if (isTauriEnvironment()) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(href);
      } else window.open(href, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(String(cause));
    }
  }, []);
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
      rawPrompt: recoveryHandoff(
        run,
        sourceIdea?.rawPrompt ?? attempts[0]?.prompt ?? run.prompt,
        reply,
      ),
      contextSelection: {
        workflowId: run.contextReceipt?.entries.find((e) => e.kind === 'workflow')?.id,
        inputValues: run.contract?.inputs,
        outcomes: (run.contract?.requirements ?? [])
          .filter((r) => !r.checkpoint)
          .map((r) => r.title),
      },
      connectionIds: run.connectionIds ?? undefined,
      assignedAgent: run.agent,
      status: 'backlog',
    });
    onCapture(id);
  };
  if (run.detailsOmitted)
    return (
      <WorkspacePage className="task-detail" aria-busy="true">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} />
          All tasks
        </Button>
        <WorkspaceHeading title={title} />
        <p role="status">Loading task…</p>
      </WorkspacePage>
    );
  return (
    <WorkspacePage className="task-detail">
      <div className="task-detail-navigation">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} />
          All tasks
        </Button>
        <div className="task-detail-utilities">
          {attempts.length > 1 && (
            <Select
              aria-label="Attempt history"
              value={run.id}
              onValueChange={(id) => useExecutionStore.getState().select(id)}
            >
              {attempts.map((attempt, index) => (
                <SelectItem key={attempt.id} value={attempt.id}>
                  Attempt {index + 1} · {statusLabel[attempt.status]}
                </SelectItem>
              ))}
            </Select>
          )}
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="ghost" aria-label="More task actions">
                <MoreHorizontal size={20} />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                className="workspace-menu"
                align="end"
                sideOffset={8}
                collisionPadding={12}
              >
                {!!run.result && (
                  <Menu.Item className="workspace-menu-item" onSelect={() => void copyResult()}>
                    <Copy size={16} />
                    Copy output
                  </Menu.Item>
                )}
                {finished && isLatest && (
                  <Menu.Item className="workspace-menu-item" onSelect={onSchedule}>
                    <CalendarClock size={16} />
                    Make recurring
                  </Menu.Item>
                )}
                <Menu.Item className="workspace-menu-item" onSelect={() => setTab('context')}>
                  Task details
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
      <WorkspaceHeading title={title} titleRef={heading} description={run.projectName} />
      <TaskProgress
        run={run}
        integrated={integrated}
        pending={pending.length}
        onActivity={() => setTab('activity')}
        action={
          active ? (
            <Button
              variant="outline"
              disabled={acting || run.status === 'stopping'}
              onClick={() => void act('task_stop')}
            >
              <Square size={14} />
              Stop
            </Button>
          ) : finished && isLatest ? (
            <div className="task-detail-utilities">
              {isolated && (
                <Button
                  onClick={() => {
                    setTab('changes');
                    setIntegrating(true);
                  }}
                >
                  <GitMerge size={16} />
                  {integrated ? 'Merge receipt' : 'Review integration'}
                </Button>
              )}
              {run.status === 'review' && (
                <Button
                  variant={isolated ? 'outline' : 'primary'}
                  disabled={acting || !!run.persistenceError}
                  onClick={() => void act('task_mark_reviewed')}
                >
                  <Check size={16} />
                  Mark reviewed
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {notice && (
        <p role="status" className="task-muted">
          {notice}
        </p>
      )}
      {!isLatest && latest && (
        <div className="task-notice">
          <span>You’re viewing an earlier attempt.</span>
          <Button variant="ghost" onClick={() => useExecutionStore.getState().select(latest.id)}>
            Open latest result
          </Button>
        </div>
      )}
      <TaskSaveRecovery run={run} />
      {run.dependencyInvalidated && (
        <InlineNotice tone="error">
          A predecessor was retried. Preserve this work and create a fresh feature plan before
          continuing or integrating.
        </InlineNotice>
      )}
      {run.error && (
        <TaskFailure
          message={run.error}
          preparation={run.preparation}
          retrying={retrying}
          onRetry={isLatest && canRetry(run) && !integrated ? () => void retry() : undefined}
          onInspect={() => setTab('activity')}
        />
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
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="result-tabs" aria-label="Task sections">
          {[
            { value: 'result', label: 'Output' },
            { value: 'changes', label: 'Review' },
            { value: 'activity', label: 'Activity' },
            { value: 'context', label: 'Details' },
          ].map(({ value, label }) => (
            <Tabs.Trigger key={value} value={value}>
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <div className="result-canvas">
          <Tabs.Content value="result">
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
                <Suspense
                  fallback={
                    <p role="status" className="task-muted">
                      Opening result…
                    </p>
                  }
                >
                  <TaskMarkdown content={run.result} active={active} onOpenLink={openLink} />
                </Suspense>
              </div>
            ) : (
              <p className="task-muted">
                {active
                  ? 'Waiting for the agent’s output…'
                  : 'No final output recorded. Review the workspace or activity to see where this attempt ended.'}
              </p>
            )}
          </Tabs.Content>
          {((!active && run.workspace) || tab === 'changes') && (
            <Tabs.Content value="changes" forceMount hidden={tab !== 'changes'}>
              {!!run.contract?.requirements.length && (
                <div className="task-review-section">
                  <TaskOutcomes
                    key={`${run.id}:${run.verification?.checkedAt ?? 'unchecked'}`}
                    run={run}
                    canReview={finished && isLatest && !integrated}
                    onCorrect={(prompt) =>
                      draft(key, { prompt: [reply, prompt].filter(Boolean).join('\n\n') })
                    }
                    onAdvance={async () => {
                      await start({
                        projectId: run.projectId,
                        projectName: run.projectName,
                        projectPath: run.projectPath,
                        agent: run.agent,
                        prompt:
                          'Continue with the next agreed workflow step. Preserve completed work and report evidence for this step.',
                        isolated: false,
                        previousRunId: run.id,
                        contextSelection: { advanceWorkflow: true },
                      });
                    }}
                  />
                </div>
              )}
              <div className="task-review-section">
                {!!(run.validationSteps?.length || run.screenshots?.length) && (
                  <ValidationJourney
                    runId={run.id}
                    steps={run.validationSteps ?? []}
                    screenshots={run.screenshots ?? []}
                  />
                )}
              </div>
              {!active && run.status !== 'interrupted' && !!run.workspace && (
                <TaskPreview key={`preview:${run.id}`} run={run} />
              )}
              {!active && run.workspace && !integrated ? (
                <ResultReview key={run.id} run={run} />
              ) : (
                <p className="task-muted">
                  {integrated
                    ? 'The reviewed patch and cleanup results are saved in the merge receipt below.'
                    : active
                      ? 'Changes become available for review after this attempt stops.'
                      : 'No workspace was recorded for this attempt. Inspect its result and activity for more detail.'}
                </p>
              )}
              {(integrating || integrated) && finished && isLatest && (
                <TaskIntegration run={run} onApplied={applied} />
              )}
            </Tabs.Content>
          )}
          <Tabs.Content value="activity">
            <TaskActivity entries={run.activity} active={active} />
          </Tabs.Content>
          <Tabs.Content value="context">
            <section className="task-environment" aria-label="Context, history and usage">
              {run.status !== 'reviewed' && <TaskLearning key={`knowledge:${run.id}`} run={run} />}
              <DefinitionList
                items={[
                  { label: 'Agent', value: run.agent },
                  { label: 'Model', value: run.model || 'Agent default' },
                  { label: 'Account', value: run.accountBinding?.label || run.account },
                  { label: 'Started', value: new Date(run.startedAt).toLocaleString() },
                  ...(run.endedAt
                    ? [{ label: 'Ended', value: new Date(run.endedAt).toLocaleString() }]
                    : []),
                  {
                    label: 'Workspace',
                    value: run.workspace || (active ? 'Preparing' : 'Not recorded'),
                  },
                  { label: 'Branch', value: run.branch || 'Not recorded' },
                  { label: 'Target', value: run.targetBranch || 'Not recorded' },
                ]}
              />
              {!!run.dependencySnapshot?.sources.length && (
                <Disclosure className="task-notice">
                  <DisclosureSummary>
                    Verified feature inputs ({run.dependencySnapshot.sources.length})
                  </DisclosureSummary>
                  {run.dependencySnapshot.sources.map((source) => (
                    <p key={source.runId}>
                      {source.runId} · {source.tree.slice(0, 12)}
                    </p>
                  ))}
                </Disclosure>
              )}
              <section className="my-4">
                <h3 className="text-base font-medium">Instruction for this attempt</h3>
                <p className="task-request whitespace-pre-wrap">{run.prompt}</p>
              </section>
              {routing && (
                <section className="my-4" aria-label="Automatic routing">
                  <h3 className="text-base font-medium">Agent selection and handoffs</h3>
                  {!routing.decisions.length && (
                    <p className="task-muted">
                      Checking available agents, models and account quotas.
                    </p>
                  )}
                  <ol className="space-y-3 mt-3">
                    {routing.decisions.map((decision, index) => (
                      <li key={decision.checkedAt}>
                        <p>
                          {decision.agent} · {decision.model || 'CLI default model'} ·{' '}
                          {decision.account}
                        </p>
                        <p className="task-muted">{decision.reason}</p>
                        <p className="task-muted">
                          Selected by {decision.orchestrator} ·{' '}
                          {decision.remainingPercent === null
                            ? 'Quota unknown'
                            : `${Math.round(decision.remainingPercent)}% headroom after local reservations at selection`}{' '}
                          · Routing usage:{' '}
                          {decision.usage.reported
                            ? `${(decision.usage.input + decision.usage.output).toLocaleString()} tokens`
                            : 'not reported'}
                        </p>
                        {routing.handoffs[index] && (
                          <p className="task-muted">
                            Quota handoff · {routing.handoffs[index].failure.message} · Worker
                            usage:{' '}
                            {routing.handoffs[index].usage.reported
                              ? `${(routing.handoffs[index].usage.input + routing.handoffs[index].usage.output).toLocaleString()} tokens`
                              : 'not reported'}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {run.prompts
                ?.filter((p) => p.status === 'answered')
                .map((p) => (
                  <UserPromptCard key={p.id} runId={run.id} prompt={p} active={false} />
                ))}
              <p className="task-muted mt-3">
                {run.effort && (
                  <>
                    Task approach: {run.effort} · Model effort:{' '}
                    {run.reasoningEffort ? `${run.reasoningEffort} requested` : 'Agent default'}
                    <br />
                  </>
                )}
                Reported usage:{' '}
                {run.usage.reported
                  ? `${(run.usage.input + run.usage.output).toLocaleString()} tokens · ${run.usage.input.toLocaleString()} input · ${run.usage.output.toLocaleString()} output${run.accountBinding?.adapter === 'kimi' || run.agent === 'kimi' ? ' · Cache breakdown unavailable' : ` · ${run.usage.cacheRead.toLocaleString()} cached input (included)`}`
                  : 'Unavailable for this attempt'}
              </p>
              {run.mcpUsage && (
                <Disclosure className="my-3">
                  <DisclosureSummary>
                    Tool discovery · {run.mcpUsage.calls}{' '}
                    {run.mcpUsage.calls === 1 ? 'call' : 'calls'}
                  </DisclosureSummary>
                  <p className="task-muted mt-2">
                    Searches: {run.mcpUsage.searches} · Catalog tools: {run.mcpUsage.catalogTools} ·
                    Failed calls: {run.mcpUsage.failures}
                  </p>
                  <p className="task-muted">
                    {(run.mcpUsage.schemaBytesReturned / 1024).toFixed(1)} KB of tool definitions
                    returned across searches. Full catalog:{' '}
                    {(run.mcpUsage.catalogBytes / 1024).toFixed(1)} KB. These are schema bytes, not
                    billed tokens or measured savings.
                  </p>
                </Disclosure>
              )}
              {!!run.diagnostics.length && (
                <Disclosure>
                  <DisclosureSummary>Agent diagnostics</DisclosureSummary>
                  <pre className="task-output">{run.diagnostics.join('\n\n')}</pre>
                </Disclosure>
              )}
            </section>
            {isLatest && (
              <section className="mt-6" aria-label="Connections for the next step">
                <h3 className="text-base font-medium mb-3">Connections for the next step</h3>
                <p className="task-muted">Changes apply to the next continuation.</p>
                {connections?.map((server) => (
                  <label key={server.id} className="flex items-center gap-3 min-h-11">
                    <Checkbox
                      checked={(
                        drafts[key]?.connectionIds ??
                        run.connectionIds ??
                        connections.map((s) => s.id)
                      ).includes(server.id)}
                      onChange={(event) => {
                        const ids =
                          drafts[key]?.connectionIds ??
                          run.connectionIds ??
                          connections.map((s) => s.id);
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
              </section>
            )}
            {!active && !run.detailsOmitted && (
              <FeedbackTouchpoint
                key={run.id}
                runId={run.id}
                paused={acting || integrating || !!reply.trim() || pending.length > 0}
              />
            )}
            {run.status === 'reviewed' && <TaskLearning key={`learning:${run.id}`} run={run} />}
            {!active && currentProject && (
              <WorkspaceReadiness
                key={`readiness:${run.id}`}
                project={currentProject}
                path={run.workspace || run.projectPath}
              />
            )}
          </Tabs.Content>
        </div>
      </Tabs.Root>
      {isLatest && (
        <div className="task-next">
          <h2 className="text-base mb-3">{integrated ? 'Start a follow-up' : 'Follow-up'}</h2>
          {canContinue ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void continueTask();
              }}
            >
              <Textarea
                id="task-reply"
                aria-label="Follow-up instructions"
                className="task-reply"
                rows={2}
                value={reply}
                onChange={(event) => draft(key, { prompt: event.target.value })}
                placeholder="Tell Jackalope what to do next…"
                maxLength={24000}
              />
              <div className="task-followup-footer">
                <p className="task-muted">
                  {active
                    ? 'Sending stops this attempt and resumes the same session.'
                    : `Continues with ${run.agent} in the same workspace and account.`}
                </p>
                <Button
                  type="submit"
                  disabled={!reply.trim() || submitting || acting || run.status === 'stopping'}
                  loading={acting || submitting}
                  loadingLabel="Continuing…"
                >
                  {active ? 'Stop and send' : 'Continue task'}
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
        </div>
      )}
      {toolsOpen && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </WorkspacePage>
  );
}
