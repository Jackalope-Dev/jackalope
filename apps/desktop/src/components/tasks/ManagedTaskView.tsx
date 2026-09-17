import { FormField, IconButton, Panel, Select, SelectItem, Textarea } from '@jackalope/ui';
import { Activity, ArrowLeft, RefreshCw } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { getAgentMetadata } from '../../lib/agent-catalog';
import type { FeatureStep } from '../../lib/feature-plan';
import {
  type ManagedTask,
  managedTaskCommand,
  managedTaskWork,
  previewTaskPlan,
} from '../../lib/managed-task';
import { queueCommand } from '../../lib/queue';
import { isActive, nativeTask, type TaskRun } from '../../lib/task-runtime';
import { taskDecision } from '../../lib/task-workflow';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { WorkspaceTabs as Tabs } from '../ui/WorkspaceTabs';
import { ManagedTaskAgent } from './ManagedTaskAgent';
import { ManagedTaskDetails } from './ManagedTaskDetails';
import { ManagedTaskJourney } from './ManagedTaskJourney';
import { MergeReview } from './MergeReview';
import { ResultReview } from './ResultReview';
import { RunStatus } from './RunStatus';
import { TaskActivity } from './TaskActivity';
import { TaskLiveActivity } from './TaskLiveActivity';
import { TaskOutcomes } from './TaskOutcomes';
import { TaskPreview } from './TaskPreview';
import { UserPromptCard } from './UserPromptCard';
import { useManagedPreview } from './useManagedPreview';

const TaskMarkdown = lazy(() => import('./TaskMarkdown'));

export function ManagedTaskView({ task, onBack }: { task: ManagedTask; onBack: () => void }) {
  const { queue, refresh, error: queueError } = useManagedTaskStore();
  const { runs, select, start } = useExecutionStore();
  const work = managedTaskWork(task, queue, runs);
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === task.request.projectId),
  );
  const [planRunId, setPlanRunId] = useState('');
  const [plan, setPlan] = useState<FeatureStep[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [correction, setCorrection] = useState('');
  const [viewTab, setViewTab] = useState('overview');
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
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await refreshAll();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const plannerId = work.planner?.id;
  const plannerStatus = work.planner?.status;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload retries the same planner receipt after a preview failure.
  useEffect(() => {
    setPlan([]);
    setPlanRunId('');
    setPlanPending(false);
    if (
      task.started ||
      !plannerId ||
      !plannerStatus ||
      !['review', 'reviewed'].includes(plannerStatus)
    )
      return;
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
        if (alive) setError(String(cause));
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
      void nativeTask('task_plan_review_time', {
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
  const continueRun = async (run: TaskRun, advanceWorkflow = false) => {
    if (!correction.trim()) return;
    await managedTaskCommand('action', { id: task.id, action: 'pause' });
    if (previewRunning) await nativeTask('task_preview_stop', { id: run.id });
    const id = await start(
      {
        ...task.request,
        agent: run.agent,
        model: run.model ?? undefined,
        agentProfileId: run.accountBinding?.profileId ?? '__default',
        previousRunId: run.id,
        prompt: correction.trim(),
        ...(advanceWorkflow ? { contextSelection: { advanceWorkflow: true } } : {}),
      },
      { background: true },
    );
    setCorrection('');
    setDetailId(id);
    setViewTab('overview');
    if (task.started) await managedTaskCommand('action', { id: task.id, action: 'resume' });
  };
  const prepareCorrection = (text: string) => {
    setCorrection(text);
    setViewTab('overview');
    requestAnimationFrame(() => document.getElementById('managed-result-correction')?.focus());
  };
  const lead = work.active[0] ?? work.combined ?? work.planner;
  const hasResult = !!work.combined && !isActive(work.combined);
  const showAssignments = task.started && (!work.combined || work.active.length > 0);
  const assignments = (
    <ManagedAssignments
      work={work}
      busy={busy}
      onDetails={openDetails}
      onActivity={openActivity}
      onRetry={(id) => void act(() => queueCommand('queue_release', { id, retry: true }))}
    />
  );
  return (
    <WorkspacePage
      ref={pageRef}
      className="managed-task workspace-stack"
      data-review={viewTab === 'review' || undefined}
    >
      <Button
        className="self-start"
        variant="outline"
        onClick={() => {
          select(null);
          onBack();
        }}
      >
        <ArrowLeft size={15} />
        All tasks
      </Button>
      <div className="managed-task-heading">
        <ManagedTaskAgent provider={lead?.agent ?? task.request.agent} run={lead} />
        <WorkspaceHeading
          titleRef={titleRef}
          title={task.title}
          description={
            <span role="status">
              {work.status} · {task.request.projectName} ·{' '}
              {getAgentMetadata(lead?.agent ?? task.request.agent)?.name ?? task.request.agent}
            </span>
          }
          action={
            <div className="managed-task-actions">
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
                <Button variant="outline" onClick={() => prepareCorrection(correction)}>
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
      {viewTab !== 'review' && <ManagedTaskJourney task={task} work={work} />}
      {(error || queueError || task.error) && (
        <InlineNotice tone="error">{error || queueError || task.error}</InlineNotice>
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
        <Tabs.Content value="overview" className="managed-overview">
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
                    <h2>Planning your task</h2>
                    <TaskLiveActivity run={work.planner} />
                  </div>
                  <Button variant="outline" onClick={() => openActivity(work.planner as TaskRun)}>
                    <Activity size={16} aria-hidden="true" /> View activity
                  </Button>
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
                        if (work.planner && ['review', 'reviewed'].includes(work.planner.status))
                          setPreviewRevision((value) => value + 1);
                        else
                          void act(() =>
                            managedTaskCommand('action', { id: task.id, action: 'retry-plan' }),
                          );
                      }}
                    >
                      {work.planner && ['review', 'reviewed'].includes(work.planner.status)
                        ? 'Reload plan'
                        : 'Retry planning'}
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
              {!!plan.length && (
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
                    <Button variant="outline" onClick={() => openDetails(work.planner as TaskRun)}>
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
                    onClick={() => void act(() => continueRun(work.combined as TaskRun))}
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
              {detail.error && <InlineNotice tone="error">{detail.error}</InlineNotice>}
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
              <Button variant="outline" className="self-start" onClick={() => openActivity(detail)}>
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
                    {['review', 'reviewed'].includes(detail.status) &&
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
                            onClick={() => void act(() => continueRun(detail))}
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
              key={work.combined.id}
              run={work.combined}
              visible={viewTab === 'review'}
              onCorrect={prepareCorrection}
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
            <TaskPreview run={work.combined} onFeedback={prepareCorrection} />
          </Tabs.Content>
        )}
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

function ManagedAssignments({
  work,
  busy,
  onDetails,
  onActivity,
  onRetry,
}: {
  work: ReturnType<typeof managedTaskWork>;
  busy: boolean;
  onDetails: (run: TaskRun) => void;
  onActivity: (run: TaskRun) => void;
  onRetry: (id: string) => void;
}) {
  return (
    <div className="managed-assignments">
      {work.steps.map(({ item, run }) => (
        <Panel key={item.id} className="managed-assignment">
          <ManagedTaskAgent provider={run?.agent ?? item.agent} run={run} />
          <div className="managed-agent-message">
            <span className="managed-agent-name">
              {getAgentMetadata(run?.agent ?? item.agent)?.name ?? 'Automatic'}
            </span>
            <h3>{item.title}</h3>
            {run && isActive(run) ? (
              <TaskLiveActivity run={run} />
            ) : (
              <p className="managed-agent-update">
                {item.error ||
                  (run
                    ? run.error || taskDecision(run, work.integrated).label
                    : item.canceled
                      ? 'Canceled'
                      : work.paused
                        ? 'Paused'
                        : item.dependencies.length
                          ? 'Waiting for earlier steps'
                          : 'Queued')}
              </p>
            )}
          </div>
          <div className="managed-task-actions">
            {run && (
              <Button
                variant="outline"
                onClick={() => (isActive(run) ? onActivity(run) : onDetails(run))}
              >
                {isActive(run) ? 'View activity' : 'View result'}
              </Button>
            )}
            {(item.error || (run && ['failed', 'stopped'].includes(run.status))) &&
              !work.active.length && (
                <Button variant="outline" disabled={busy} onClick={() => onRetry(item.id)}>
                  Retry assignment
                </Button>
              )}
          </div>
        </Panel>
      ))}
    </div>
  );
}
