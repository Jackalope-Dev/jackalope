import { describeError } from '@jackalope/contracts/errors';
import { isActive, isDone } from '@jackalope/contracts/runs';
import {
  Button,
  FormField,
  IconButton,
  InlineNotice,
  Panel,
  Select,
  SelectItem,
  Textarea,
} from '@jackalope/ui';
import { Activity, RefreshCw } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAction } from '../../hooks/useAction';
import { useWideWorkspace } from '../../hooks/useWideWorkspace';
import { getAgentMetadata } from '../../lib/agent-catalog';
import { parseDispatchPaused, pausedDispatchMessages } from '../../lib/dispatch-paused';
import {
  type FeatureStep,
  type ManagedTask,
  managedTaskCommand,
  managedTaskWork,
  previewTaskPlan,
} from '../../lib/managed-task';
import { openExternalUrl } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { queueCommand } from '../../lib/queue';
import { appendFeedbackDraft } from '../../lib/review-feedback';
import type { TaskRun } from '../../lib/run-types';
import { releaseInterrupted, stopPreview } from '../../lib/task-client';
import { useExecutionStore } from '../../stores/executionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkViewStore } from '../../stores/workViewStore';
import { ActionError } from '../ui/ActionError';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { WorkspaceTabs as Tabs } from '../ui/WorkspaceTabs';
import { DispatchPausedNotice } from './DispatchPausedNotice';
import { ManagedAssignments } from './ManagedAssignments';
import { ManagedTaskAgent } from './ManagedTaskAgent';
import { ManagedTaskDetails } from './ManagedTaskDetails';
import { ManagedTaskJourney } from './ManagedTaskJourney';
import { MergeReview } from './MergeReview';
import { ResultReview } from './ResultReview';
import { ResumeInterrupted, resumePrompt } from './ResumeInterrupted';
import { RunStatus } from './RunStatus';
import { TaskActivity } from './TaskActivity';
import { TaskLiveActivity } from './TaskLiveActivity';
import { TaskOutcomes } from './TaskOutcomes';
import { TaskPreview } from './TaskPreview';
import { UserPromptCard } from './UserPromptCard';
import { useManagedPreview } from './useManagedPreview';
import { WorkContext } from './WorkContext';
import { WorkFeedbackInbox } from './WorkFeedbackInbox';
import { WorkSourceLink } from './WorkSourceLink';

const TaskMarkdown = lazy(() => import('./TaskMarkdown'));

export function ManagedTaskView({ task }: { task: ManagedTask }) {
  const {
    queue,
    refresh,
    error: queueError,
  } = useManagedTaskStore(
    useShallow((s) => ({ queue: s.queue, refresh: s.refresh, error: s.error })),
  );
  const { runs, select, start } = useExecutionStore(
    useShallow((s) => ({ runs: s.runs, select: s.select, start: s.start })),
  );
  const work = managedTaskWork(task, queue, runs);
  // A paused dispatch is explained by its own notice rather than as a raw error.
  const shownQueueError = parseDispatchPaused(queueError) ? null : queueError;
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === task.request.projectId),
  );
  const [planRunId, setPlanRunId] = useState('');
  const [plan, setPlan] = useState<FeatureStep[]>([]);
  const { run: act, busy, error, setError } = useAction(() => refreshAll());
  const [notice, setNotice] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const correctionKey = `managed-reply:${task.id}`;
  const correction = useExecutionStore((state) => state.drafts[correctionKey]?.prompt ?? '');
  const setCorrection = (prompt: string) =>
    useExecutionStore.getState().draft(correctionKey, { prompt });
  const hasResult = !!work.combined && !isActive(work.combined);
  const [viewTab, setViewTab] = useState('overview');
  const workRequest = useWorkViewStore((state) => state.request);
  const handledWorkRequest = useRef<number | null>(null);
  useEffect(() => {
    if (
      workRequest?.id !== `managed:${task.id}` ||
      handledWorkRequest.current === workRequest.revision
    )
      return;
    handledWorkRequest.current = workRequest.revision;
    setViewTab(workRequest.section === 'changes' && hasResult ? 'review' : 'overview');
  }, [workRequest, task.id, hasResult]);
  const wide = useWideWorkspace();
  const split = useWorkViewStore((state) => state.split[`managed:${task.id}`] ?? wide);
  const alongside = split && ['review', 'preview'].includes(viewTab);
  const [planPending, setPlanPending] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const pageRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wasStarted = useRef(task.started);
  const overviewTabRef = useRef<HTMLButtonElement>(null);
  const activityTabRef = useRef<HTMLButtonElement>(null);
  const reviewTabRef = useRef<HTMLButtonElement>(null);
  const previewRunning = useManagedPreview(work.combined?.id, work.ready && !work.integrated);
  const selectionKey = work.steps.flatMap(({ run }) => (run ? [run.id] : [])).join(',');
  const reviewRunIds = useMemo(() => selectionKey.split(',').filter(Boolean), [selectionKey]);
  const detail = work.work.find((run) => run.id === detailId);
  useEffect(() => {
    if (task.started && !wasStarted.current) {
      setDetailId(null);
      setViewTab('overview');
      pageRef.current?.scrollIntoView({ block: 'start' });
      titleRef.current?.focus({ preventScroll: true });
    }
    wasStarted.current = task.started;
  }, [task.started]);
  const activityRun =
    work.work.find((run) => run.id === activityId) ??
    work.active[0] ??
    work.combined ??
    work.planner ??
    work.work.at(-1);
  const refreshAll = async () => {
    await refresh();
    await useExecutionStore.getState().refresh();
  };
  const plannerId = work.planner?.id;
  const plannerStatus = work.planner?.status;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload retries the same planner receipt after a preview failure.
  useEffect(() => {
    setPlan([]);
    setPlanRunId('');
    setPlanPending(false);
    if (task.started || !plannerId || !plannerStatus || !isDone(plannerStatus)) return;
    let alive = true;
    setPlanPending(true);
    void previewTaskPlan(task.id)
      .then((steps) => {
        if (alive) {
          setPlanRunId(plannerId);
          setPlan(steps);
          setError('');
        }
      })
      .catch((cause) => {
        if (alive) setError(describeError(cause));
      })
      .finally(() => {
        if (alive) setPlanPending(false);
      });
    return () => {
      alive = false;
    };
  }, [task.id, task.started, plannerId, plannerStatus, previewRevision]);
  const selectedResult =
    viewTab === 'activity'
      ? activityRun?.id
      : (detailId ?? (work.combined && !isActive(work.combined) ? work.combined.id : null));
  useEffect(() => {
    if (selectedResult) select(selectedResult);
    return () => select(null);
  }, [selectedResult, select]);
  const recordReview =
    !!task.delivery &&
    work.ready &&
    !work.integrated &&
    ['overview', 'review', 'preview'].includes(viewTab);
  useEffect(() => {
    if (!recordReview) return;
    let seconds = 0;
    const flush = () => {
      if (!seconds) return;
      const value = seconds;
      seconds = 0;
      void invokeNative('task_plan_review_time', {
        id: task.id,
        sampleId: crypto.randomUUID(),
        seconds: value,
      }).catch(() => {});
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) seconds++;
      if (seconds >= 30) flush();
    }, 1000);
    return () => {
      clearInterval(timer);
      flush();
    };
  }, [recordReview, task.id]);
  const openDetails = (run: TaskRun) => {
    setViewTab('overview');
    if (run.id === work.combined?.id && !isActive(run)) {
      setDetailId(null);
      requestAnimationFrame(() => overviewTabRef.current?.focus());
      return;
    }
    setDetailId(run.id);
    requestAnimationFrame(() => document.getElementById('managed-attempt-result')?.focus());
  };
  const openActivity = (run: TaskRun) => {
    setActivityId(run.id);
    setViewTab('activity');
    requestAnimationFrame(() => activityTabRef.current?.focus());
  };
  const continueRun = async (run: TaskRun, prompt: string) => {
    await managedTaskCommand('action', { id: task.id, action: 'pause' });
    if (previewRunning) await stopPreview(run.id);
    const id = await start(
      {
        ...task.request,
        agent: run.agent,
        model: run.model ?? undefined,
        agentProfileId: run.accountBinding?.profileId ?? '__default',
        previousRunId: run.id,
        prompt,
      },
      { background: true },
    );
    setDetailId(id);
    setViewTab('overview');
    if (task.started) await managedTaskCommand('action', { id: task.id, action: 'resume' });
  };
  const sendCorrection = async (run: TaskRun) => {
    const prompt = correction.trim();
    if (!prompt) return;
    await continueRun(run, prompt);
    setCorrection('');
  };
  const interrupted = [work.planner, ...work.steps.map(({ run }) => run)].find(
    (run) => run?.status === 'interrupted',
  );
  /** Picks up an interrupted attempt the person checked: its conversation, or a fresh attempt. */
  const resumeRun = async (run: TaskRun, instructions: string) => {
    await releaseInterrupted(run.id);
    await refreshAll();
    const item = work.steps.find((step) => step.run?.id === run.id)?.item;
    if (run.sessionId) await continueRun(run, resumePrompt(instructions));
    else if (run.id === work.planner?.id)
      await managedTaskCommand('action', { id: task.id, action: 'retry-plan' });
    else if (item) {
      await queueCommand('queue_release', { id: item.id, retry: true });
      if (task.started) await managedTaskCommand('action', { id: task.id, action: 'resume' });
    }
    await refreshAll();
  };
  const prepareCorrection = (text: string) => {
    setCorrection(appendFeedbackDraft(correction, text));
    if (!alongside) setViewTab('overview');
    requestAnimationFrame(() => document.getElementById('managed-result-correction')?.focus());
  };
  const lead = work.active[0] ?? work.combined ?? work.planner;
  const showAssignments = task.started && (!work.combined || work.active.length > 0);
  const assignments = (
    <ManagedAssignments
      work={work}
      busy={busy}
      onDetails={openDetails}
      onActivity={openActivity}
      onRetry={(id) => void act(() => queueCommand('queue_release', { id, retry: true }))}
      onNotice={(message, failed) => (failed ? setError : setNotice)(message)}
    />
  );
  return (
    <WorkspacePage ref={pageRef} className="managed-task workspace-stack">
      <div className="managed-task-heading">
        <ManagedTaskAgent provider={lead?.agent ?? task.request.agent} run={lead} />
        <WorkspaceHeading
          titleRef={titleRef}
          title={task.title}
          description={<span role="status">{work.status}</span>}
          action={
            <div className="managed-task-actions">
              {interrupted && !work.active.length && !work.integrated && (
                <ResumeInterrupted
                  run={interrupted}
                  disabled={busy}
                  onResume={(instructions) => resumeRun(interrupted, instructions)}
                />
              )}
              {task.delivery &&
                task.error &&
                task.delivery.repairs.length >= task.delivery.repairLimit &&
                !work.active.length &&
                !work.integrated && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        managedTaskCommand('action', { id: task.id, action: 'retry-repair' }),
                      )
                    }
                  >
                    Try another repair
                  </Button>
                )}
              {task.started && !work.integrated && !work.ready && !work.failed && (
                <Button
                  variant="outline"
                  disabled={busy || work.failed}
                  onClick={() =>
                    void act(() =>
                      managedTaskCommand('action', {
                        id: task.id,
                        action: work.paused ? 'resume' : 'pause',
                      }),
                    )
                  }
                >
                  {work.paused ? 'Resume task' : 'Pause dispatch'}
                </Button>
              )}
              {!!work.active.length && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(() => managedTaskCommand('action', { id: task.id, action: 'stop' }))
                  }
                >
                  Stop task
                </Button>
              )}
              {work.combined &&
                !isActive(work.combined) &&
                !work.active.length &&
                !work.integrated &&
                viewTab !== 'review' && (
                  <Button
                    variant={interrupted ? 'outline' : undefined}
                    onClick={() => {
                      setDetailId(null);
                      setViewTab('review');
                      requestAnimationFrame(() => reviewTabRef.current?.focus());
                      void act(() =>
                        managedTaskCommand('action', { id: task.id, action: 'pause' }),
                      );
                    }}
                  >
                    Review changes
                  </Button>
                )}
              {hasResult && !work.integrated && !work.active.length && viewTab !== 'overview' && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setViewTab('overview');
                    requestAnimationFrame(() =>
                      document.getElementById('managed-result-correction')?.focus(),
                    );
                  }}
                >
                  Request changes
                </Button>
              )}
              <IconButton
                label="Refresh task"
                title="Refresh task"
                onClick={() => void act(refreshAll)}
                disabled={busy}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </IconButton>
            </div>
          }
        />
      </div>
      {(!hasResult || work.active.length > 0) && <ManagedTaskJourney task={task} work={work} />}
      {hasResult && !work.active.length && work.interfaceIssue && (
        <InlineNotice>{work.interfaceIssue}</InlineNotice>
      )}
      {task.delivery?.held && !task.delivery.appliedAt && (
        <InlineNotice>Not merged automatically. {task.delivery.held}</InlineNotice>
      )}
      {notice && (
        <InlineNotice
          tone="success"
          action={
            <Button variant="ghost" onClick={() => setNotice('')}>
              Close
            </Button>
          }
        >
          {notice}
        </InlineNotice>
      )}
      {project &&
        pausedDispatchMessages(queue?.pausedIntegrations, queueError, project.path).map(
          (message) => <DispatchPausedNotice key={message} error={message} />,
        )}
      {(error || shownQueueError || task.error) && (
        <InlineNotice tone="error">{error || shownQueueError || task.error}</InlineNotice>
      )}
      {work.missingAttempts.length > 0 && (
        <InlineNotice tone="warning">
          {work.missingAttempts.length} saved attempts are not loaded. History and usage are
          incomplete. Restore archived attempts or reload history to inspect them.
        </InlineNotice>
      )}
      {work.questions.map(({ run, prompt }) => (
        <UserPromptCard key={prompt.id} runId={run.id} prompt={prompt} active />
      ))}
      <Tabs.Root className="managed-task-tabs" value={viewTab} onValueChange={setViewTab}>
        <WorkSourceLink prompts={[task.request.prompt]} />
        {work.combined && <WorkContext key={`context:${task.id}`} run={work.combined} />}
        {work.combined && !work.integrated && (
          <WorkFeedbackInbox
            key={`feedback:${work.combined.taskId}`}
            taskId={work.combined.taskId}
            onFeedback={prepareCorrection}
          />
        )}
        <Tabs.List aria-label="Planned task views">
          <Tabs.Trigger ref={overviewTabRef} value="overview">
            Overview
          </Tabs.Trigger>
          {hasResult && (
            <Tabs.Trigger ref={reviewTabRef} value="review">
              Review
            </Tabs.Trigger>
          )}
          {hasResult && !work.integrated && <Tabs.Trigger value="preview">Preview</Tabs.Trigger>}
          <Tabs.Trigger ref={activityTabRef} value="activity">
            Activity
          </Tabs.Trigger>
          <Tabs.Trigger value="details">Details</Tabs.Trigger>
        </Tabs.List>
        {['review', 'preview'].includes(viewTab) && (
          <Button
            variant="ghost"
            className="self-start"
            aria-pressed={split}
            onClick={() => useWorkViewStore.getState().setSplit(`managed:${task.id}`, !split)}
          >
            {split ? 'Hide conversation' : 'Show conversation'}
          </Button>
        )}
        <div className="managed-task-panels" data-alongside={alongside || undefined}>
          <Tabs.Content
            value="overview"
            className="managed-overview"
            forceMount
            hidden={viewTab !== 'overview' && !alongside}
          >
            {showAssignments && (
              <section className="workspace-section workspace-stack" aria-label="Assignments">
                <WorkspaceSectionHeading title="Assignments" />
                {assignments}
              </section>
            )}
            {!task.started && (
              <section className="workspace-section workspace-stack" aria-label="Proposed work">
                {work.planner && isActive(work.planner) ? (
                  <Panel className="managed-planning-status">
                    <ManagedTaskAgent provider={work.planner.agent} run={work.planner} />
                    <div className="managed-agent-message">
                      <span className="managed-agent-name">
                        {getAgentMetadata(work.planner.agent)?.name ?? work.planner.agent}
                      </span>
                      <h2>
                        {task.autoStart && !task.error
                          ? 'Splitting your task into subtasks'
                          : 'Planning your task'}
                      </h2>
                      <TaskLiveActivity run={work.planner} />
                    </div>
                    <div className="managed-task-actions">
                      {task.autoStart && !task.error && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              managedTaskCommand('action', { id: task.id, action: 'review-first' }),
                            )
                          }
                        >
                          Review before starting
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => openActivity(work.planner as TaskRun)}
                      >
                        <Activity size={16} aria-hidden="true" /> View activity
                      </Button>
                    </div>
                  </Panel>
                ) : planPending ? (
                  <p className="task-muted" role="status">
                    Loading the proposed plan…
                  </p>
                ) : !plan.length ? (
                  <Panel className="workspace-stack">
                    <WorkspaceSectionHeading
                      title="Planning needs attention"
                      description={work.planner?.error}
                    />
                    <div className="managed-task-actions">
                      <Button
                        disabled={busy}
                        onClick={() => {
                          if (work.planner && isDone(work.planner))
                            setPreviewRevision((value) => value + 1);
                          else
                            void act(() =>
                              managedTaskCommand('action', { id: task.id, action: 'retry-plan' }),
                            );
                        }}
                      >
                        {work.planner && isDone(work.planner) ? 'Reload plan' : 'Retry planning'}
                      </Button>
                      {work.planner && (
                        <Button
                          variant="outline"
                          onClick={() => openActivity(work.planner as TaskRun)}
                        >
                          View activity
                        </Button>
                      )}
                    </div>
                  </Panel>
                ) : task.autoStart && !task.error ? (
                  <WorkspaceSectionHeading
                    title="Starting subtasks"
                    description={`${plan.length} ${plan.length === 1 ? 'step' : 'steps'} start automatically.`}
                  />
                ) : (
                  <WorkspaceSectionHeading
                    title="Review your plan"
                    description={`${plan.length} steps`}
                  />
                )}
                {!!plan.length && (
                  <ol className="managed-plan">
                    {plan.map((step, index) => (
                      <li key={step.key}>
                        <Panel className="managed-plan-step">
                          <header>
                            <ManagedTaskAgent provider={step.agent} />
                            <div>
                              <span className="managed-agent-name">
                                {getAgentMetadata(step.agent)?.name ??
                                  (step.agent === 'auto' ? 'Automatic' : step.agent)}
                              </span>
                              <h3>{step.title}</h3>
                            </div>
                            <span className="managed-plan-number" aria-hidden="true">
                              {index + 1}
                            </span>
                          </header>
                          <p className="managed-plan-description">
                            {step.prompt.split('\n\nComplete request')[0]}
                          </p>
                          <p className="managed-plan-dependency">
                            {step.dependsOn.length
                              ? `After: ${step.dependsOn.map((key) => plan.find((entry) => entry.key === key)?.title ?? key).join(', ')}`
                              : 'Can start independently'}
                          </p>
                          <ul className="managed-plan-scopes" aria-label="Files and folders">
                            {step.scopes.map((scope) => (
                              <li key={scope}>
                                <code>{scope}</code>
                              </li>
                            ))}
                          </ul>
                        </Panel>
                      </li>
                    ))}
                  </ol>
                )}
                {!!plan.length && (!task.autoStart || !!task.error) && (
                  <div className="managed-plan-start">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          managedTaskCommand('start', { id: task.id, plannerRunId: planRunId }),
                        )
                      }
                    >
                      Start reviewed plan
                    </Button>
                    {work.planner && (
                      <Button
                        variant="outline"
                        onClick={() => openDetails(work.planner as TaskRun)}
                      >
                        Adjust plan
                      </Button>
                    )}
                  </div>
                )}
              </section>
            )}
            {work.combined && !isActive(work.combined) && !detail && (
              <section className="managed-result" aria-label="Complete task result">
                <div className="managed-result-body">
                  {work.combined.detailsOmitted ? (
                    <p role="status">Loading the combined result…</p>
                  ) : (
                    <Suspense fallback={<p>Loading result…</p>}>
                      <TaskMarkdown
                        content={work.combined.result || 'Open review to inspect this result.'}
                        active={false}
                        onOpenLink={(url) => void openExternalUrl(url)}
                      />
                    </Suspense>
                  )}
                </div>
                {!work.integrated && !work.active.length && (
                  <div className="managed-followup">
                    <FormField label="What would you like to change?">
                      <Textarea
                        id="managed-result-correction"
                        rows={2}
                        maxLength={12000}
                        value={correction}
                        placeholder="Describe a change to this result…"
                        onChange={(event) => setCorrection(event.target.value)}
                      />
                    </FormField>
                    <Button
                      variant="outline"
                      disabled={busy || !correction.trim()}
                      onClick={() => void act(() => sendCorrection(work.combined as TaskRun))}
                    >
                      {previewRunning ? 'Stop preview and update result' : 'Update result'}
                    </Button>
                  </div>
                )}
              </section>
            )}
            {detail && (
              <Panel
                id="managed-attempt-result"
                tabIndex={-1}
                aria-label="Assignment details"
                className="managed-attempt-result workspace-stack"
              >
                <WorkspaceSectionHeading
                  level={3}
                  title={
                    detail.id === work.planner?.id
                      ? 'Planning result'
                      : (work.steps.find(({ run }) => run?.id === detail.id)?.item.title ??
                        'Follow-up')
                  }
                  action={
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDetailId(null);
                        requestAnimationFrame(() => overviewTabRef.current?.focus());
                      }}
                    >
                      Close details
                    </Button>
                  }
                />
                <ActionError error={detail.error} />
                {detail.detailsOmitted ? (
                  <p role="status">Loading result…</p>
                ) : (
                  <Suspense fallback={<p>Loading result…</p>}>
                    <TaskMarkdown
                      content={
                        detail.result ||
                        (isActive(detail)
                          ? 'The result will appear here when the agent finishes.'
                          : 'No result was recorded. Open activity to inspect this attempt.')
                      }
                      active={isActive(detail)}
                      onOpenLink={(url) => void openExternalUrl(url)}
                    />
                  </Suspense>
                )}
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={() => openActivity(detail)}
                >
                  <Activity size={16} aria-hidden="true" /> View activity
                </Button>
                {!isActive(detail) &&
                  detail.id !== work.combined?.id &&
                  !work.integrated &&
                  !work.active.length && (
                    <>
                      {['failed', 'stopped'].includes(detail.status) &&
                        detail.id === work.planner?.id && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                await managedTaskCommand('action', {
                                  id: task.id,
                                  action: 'retry-plan',
                                });
                                setDetailId(null);
                              })
                            }
                          >
                            Retry planning
                          </Button>
                        )}
                      {isDone(detail) &&
                        (detail.id === work.planner?.id ||
                          work.steps.some(({ run }) => run?.id === detail.id)) &&
                        (!task.started ||
                          detail.id === work.combined?.id ||
                          !work.steps.some(
                            ({ item }) =>
                              item.dependencies.includes(
                                work.steps.find(({ run }) => run?.id === detail.id)?.item.id ?? '',
                              ) && !!item.runId,
                          )) && (
                          <>
                            <label className="task-label" htmlFor="managed-correction">
                              Follow up in this task
                            </label>
                            <Textarea
                              id="managed-correction"
                              rows={3}
                              maxLength={12000}
                              value={correction}
                              onChange={(event) => setCorrection(event.target.value)}
                            />
                            <Button
                              disabled={busy || !correction.trim()}
                              onClick={() => void act(() => sendCorrection(detail))}
                            >
                              Send follow-up
                            </Button>
                          </>
                        )}
                    </>
                  )}
              </Panel>
            )}
          </Tabs.Content>
          {hasResult && work.combined && (
            <Tabs.Content value="review" forceMount hidden={viewTab !== 'review'}>
              <ResultReview
                canApprove={!work.active.length && !work.integrated}
                key={work.combined.id}
                run={work.combined}
                visible={viewTab === 'review'}
                onCorrect={!work.integrated && !work.active.length ? prepareCorrection : undefined}
                unavailable={
                  work.integrated ? (
                    <p className="task-muted">The applied patch is saved in the merge receipt.</p>
                  ) : undefined
                }
                outcomes={
                  <TaskOutcomes
                    run={work.combined}
                    canReview={!work.active.length && !work.integrated}
                    onCorrect={prepareCorrection}
                    onAdvance={async () => {
                      throw new Error('Continue this task through its follow-up.');
                    }}
                  />
                }
                delivery={
                  project && (
                    <MergeReview
                      key={selectionKey}
                      project={project}
                      runs={runs}
                      items={work.items}
                      merged={queue.mergedRunIds}
                      onChanged={refreshAll}
                      onlyRunIds={reviewRunIds}
                      managedTitle={task.title}
                      changesReviewed={!work.integrated}
                    />
                  )
                }
              />
            </Tabs.Content>
          )}
          {hasResult && work.combined && !work.integrated && (
            <Tabs.Content value="preview">
              <TaskPreview
                key={work.combined.id}
                run={work.combined}
                onFeedback={prepareCorrection}
              />
            </Tabs.Content>
          )}
        </div>
        <Tabs.Content value="activity" className="managed-activity">
          {activityRun ? (
            <>
              <div className="managed-activity-toolbar">
                <ManagedTaskAgent provider={activityRun.agent} run={activityRun} />
                <FormField label={`Attempt history (${work.work.length})`}>
                  <Select
                    value={activityRun.id}
                    onValueChange={setActivityId}
                    aria-label="Choose attempt"
                  >
                    {work.work.map((run) => (
                      <SelectItem key={run.id} value={run.id}>
                        {run.id === work.planner?.id
                          ? 'Planning'
                          : (work.steps.find(({ run: step }) => step?.id === run.id)?.item.title ??
                            'Follow-up')}{' '}
                        · {run.agent} · {new Date(run.startedAt).toLocaleString()}
                      </SelectItem>
                    ))}
                  </Select>
                </FormField>
                <RunStatus status={activityRun.status} progress={activityRun.progress} />
                {!isActive(activityRun) && (
                  <Button variant="outline" onClick={() => openDetails(activityRun)}>
                    View result
                  </Button>
                )}
              </div>
              <TaskLiveActivity run={activityRun} />
              <TaskActivity entries={activityRun.activity} active={isActive(activityRun)} />
            </>
          ) : (
            <p className="task-muted">No attempts have been recorded yet.</p>
          )}
        </Tabs.Content>
        <Tabs.Content value="details" className="managed-overview">
          <ManagedTaskDetails task={task} work={work} />
          {task.started && (
            <Panel className="workspace-stack">
              <WorkspaceSectionHeading title="Work in this task" />
              {assignments}
            </Panel>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </WorkspacePage>
  );
}
