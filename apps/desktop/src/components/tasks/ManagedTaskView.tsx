import {
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  FormField,
  IconButton,
  Textarea,
} from '@jackalope/ui';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { decisionUsageEntries } from '../../lib/decision-usage';
import type { FeatureStep } from '../../lib/feature-plan';
import {
  type ManagedTask,
  managedTaskCommand,
  managedTaskWork,
  previewTaskPlan,
} from '../../lib/managed-task';
import { queueCommand } from '../../lib/queue';
import { isActive, nativeTask, type TaskRun } from '../../lib/task-runtime';
import { openExternalUrl } from '../../lib/tauri-bridge';
import { usageEntries } from '../../lib/usage-entries';
import { summarizeUsage } from '../../lib/usage-insights';
import { useExecutionStore } from '../../stores/executionStore';
import { useManagedTaskStore } from '../../stores/managedTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceSectionHeading } from '../ui/WorkspaceSectionHeading';
import { WorkspaceSubnavigation } from '../ui/WorkspaceSubnavigation';
import { ManagedTaskJourney } from './ManagedTaskJourney';
import { MergeReview } from './MergeReview';
import { ProjectVerification } from './ProjectVerification';
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
  const [correction, setCorrection] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [resultTab, setResultTab] = useState<'result' | 'changes' | 'preview'>('result');
  const resultRef = useRef<HTMLElement>(null);
  const previewRunning = useManagedPreview(work.combined?.id, work.ready && !work.integrated);
  const selectionKey = work.steps.flatMap(({ run }) => (run ? [run.id] : [])).join(',');
  const reviewRunIds = useMemo(() => selectionKey.split(',').filter(Boolean), [selectionKey]);
  const detail = work.work.find((run) => run.id === detailId);
  const combinedId = work.combined?.id;
  useEffect(() => {
    if (work.failed || (task.started && !combinedId)) setDetailsOpen(true);
    else if (work.ready) setDetailsOpen(false);
  }, [work.failed, work.ready, task.started, combinedId]);
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
  useEffect(() => {
    setPlan([]);
    if (
      task.started ||
      !plannerId ||
      !plannerStatus ||
      !['review', 'reviewed'].includes(plannerStatus)
    )
      return;
    let alive = true;
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
      });
    return () => {
      alive = false;
    };
  }, [task.id, task.started, plannerId, plannerStatus]);
  const selectedResult =
    detailId ?? (work.combined && !isActive(work.combined) ? work.combined.id : null);
  useEffect(() => {
    if (selectedResult) select(selectedResult);
    return () => select(null);
  }, [selectedResult, select]);
  const recordReview = !!task.delivery && work.ready && !work.integrated;
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
  const usage = summarizeUsage([
    ...usageEntries(work.work),
    ...(task.assessment.cached ? [] : decisionUsageEntries(task.assessment.decision)),
  ]);
  const openDetails = (run: TaskRun) => {
    if (run.id === work.combined?.id) {
      setDetailId(null);
      setResultTab('result');
      return;
    }
    setDetailId(run.id);
    setDetailsOpen(true);
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
    setDetailsOpen(true);
    if (task.started) await managedTaskCommand('action', { id: task.id, action: 'resume' });
  };
  const prepareCorrection = (text: string) => {
    setCorrection(text);
    setResultTab('result');
    requestAnimationFrame(() => document.getElementById('managed-result-correction')?.focus());
  };
  return (
    <WorkspacePage className="managed-task workspace-stack">
      <Button
        className="self-start"
        variant="ghost"
        onClick={() => {
          select(null);
          onBack();
        }}
      >
        <ArrowLeft size={15} />
        All tasks
      </Button>
      <WorkspaceHeading
        title={task.title}
        description={
          <span role="status">
            {work.status} · {task.request.projectName}
          </span>
        }
        action={
          <div className="managed-task-actions">
            {task.delivery && task.error && !work.active.length && !work.integrated && (
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
            {task.started && !work.integrated && !work.ready && (
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
            {work.ready && !work.integrated && resultTab !== 'changes' && (
              <Button
                onClick={() => {
                  setDetailId(null);
                  setResultTab('changes');
                  requestAnimationFrame(() =>
                    resultRef.current
                      ?.querySelector<HTMLButtonElement>('[aria-current="page"]')
                      ?.focus(),
                  );
                  void act(() => managedTaskCommand('action', { id: task.id, action: 'pause' }));
                }}
              >
                Review changes
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
      <ManagedTaskJourney task={task} work={work} />
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
      {!task.started && (
        <section className="workspace-section workspace-stack" aria-label="Proposed work">
          <WorkspaceSectionHeading title="Proposed work" />
          {work.planner && isActive(work.planner) && (
            <p className="task-muted" role="status">
              Checking repository boundaries before proposing assignments.
            </p>
          )}
          <div className="managed-plan">
            {plan.map((step, index) => (
              <Disclosure key={step.key}>
                <DisclosureSummary>
                  <span className="managed-plan-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  {step.title}
                </DisclosureSummary>
                <DisclosureBody>
                  <p className="task-muted">
                    {step.dependsOn.length
                      ? `After: ${step.dependsOn.map((key) => plan.find((entry) => entry.key === key)?.title ?? key).join(', ')}`
                      : 'Can start independently'}
                  </p>
                  <p className="task-muted">Files and folders: {step.scopes.join(', ')}</p>
                  <p className="whitespace-pre-wrap">
                    {step.prompt.split('\n\nComplete request')[0]}
                  </p>
                </DisclosureBody>
              </Disclosure>
            ))}
          </div>
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
              <p className="task-muted">
                Includes combined checks and up to two repair attempts. Changes are applied only
                after your review.
              </p>
            </div>
          )}
          {!work.planner && (
            <Button
              disabled={busy}
              onClick={() =>
                void act(() => managedTaskCommand('action', { id: task.id, action: 'retry-plan' }))
              }
            >
              Retry planning
            </Button>
          )}
          {work.planner && (
            <Button
              className="self-start"
              variant="ghost"
              onClick={() => openDetails(work.planner as TaskRun)}
            >
              Planning result and corrections
            </Button>
          )}
        </section>
      )}
      {work.combined && !isActive(work.combined) && (
        <section ref={resultRef} className="managed-result" aria-label="Complete task result">
          <WorkspaceSubnavigation
            label="Task result"
            value={resultTab}
            onChange={setResultTab}
            items={[
              { id: 'result', label: 'Result' },
              { id: 'changes', label: 'Review' },
              ...(!work.integrated ? [{ id: 'preview' as const, label: 'Preview' }] : []),
            ]}
          />
          <div className="managed-result-body">
            {resultTab === 'result' &&
              (work.combined.detailsOmitted ? (
                <p role="status">Loading the combined result…</p>
              ) : (
                <Suspense fallback={<p>Loading result…</p>}>
                  <TaskMarkdown
                    content={
                      work.combined.result ||
                      'Open the checks and work details to inspect this result.'
                    }
                    active={false}
                    onOpenLink={(url) => void openExternalUrl(url)}
                  />
                </Suspense>
              ))}
            {resultTab === 'changes' && (
              <>
                <TaskOutcomes
                  run={work.combined}
                  canReview={!work.integrated && !work.active.length}
                  onCorrect={prepareCorrection}
                  onAdvance={async () => {
                    throw new Error('Continue this task through the follow-up below.');
                  }}
                />
                {!work.integrated && (
                  <Disclosure
                    className="managed-checks"
                    open={!work.combined.verification?.result.success || undefined}
                  >
                    <DisclosureSummary>
                      {work.combined.verification?.result.success
                        ? 'Combined checks passed'
                        : 'Checks need attention'}
                    </DisclosureSummary>
                    <DisclosureBody>
                      <ProjectVerification run={work.combined} onCorrect={prepareCorrection} />
                    </DisclosureBody>
                  </Disclosure>
                )}
                {project && (
                  <MergeReview
                    key={selectionKey}
                    project={project}
                    runs={runs}
                    items={work.items}
                    merged={queue.mergedRunIds}
                    onChanged={refreshAll}
                    onlyRunIds={reviewRunIds}
                    managedTitle={task.title}
                  />
                )}
              </>
            )}
            {resultTab === 'preview' && !work.integrated && (
              <TaskPreview run={work.combined} onFeedback={prepareCorrection} />
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
      <Disclosure
        className="managed-details"
        open={detailsOpen}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <DisclosureSummary>Task details</DisclosureSummary>
        <DisclosureBody>
          <Disclosure>
            <DisclosureSummary>Request and approach</DisclosureSummary>
            <DisclosureBody>
              <p className="whitespace-pre-wrap">{task.request.prompt}</p>
              <p className="task-muted">{task.assessment.reason}</p>
              {task.assessment.cached && (
                <p className="task-muted">Assessment reused; no additional assessment call.</p>
              )}
              {task.assessment.decision.fallbackReason && (
                <p>{task.assessment.decision.fallbackReason}</p>
              )}
            </DisclosureBody>
          </Disclosure>
          {task.started && (
            <Disclosure open={work.failed || !work.combined || undefined}>
              <DisclosureSummary>Work details</DisclosureSummary>
              <DisclosureBody>
                <section aria-label="Work in this task">
                  {work.steps.map(({ item, run }) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap justify-between gap-3 border-b border-[var(--color-border)] py-3"
                    >
                      <div>
                        <strong>{item.title}</strong>
                        <p className="task-muted">
                          {item.error ||
                            (run
                              ? isActive(run)
                                ? (run.progress?.label ?? 'Working')
                                : run.verificationError ||
                                  run.error ||
                                  (run.verification?.result.success ? 'Checks passed' : run.status)
                              : work.paused
                                ? 'Paused'
                                : item.dependencies.length
                                  ? 'Waiting for verified dependencies'
                                  : 'Waiting for capacity')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {run && (
                          <Button variant="ghost" onClick={() => openDetails(run)}>
                            Details
                          </Button>
                        )}
                        {(item.error || (run && ['failed', 'stopped'].includes(run.status))) &&
                          !work.active.length && (
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  queueCommand('queue_release', { id: item.id, retry: true }),
                                )
                              }
                            >
                              Retry assignment
                            </Button>
                          )}
                      </div>
                    </div>
                  ))}
                </section>
              </DisclosureBody>
            </Disclosure>
          )}
          {detail && (
            <section aria-label="Assignment details" className="workspace-section workspace-stack">
              <WorkspaceSectionHeading
                level={3}
                title={
                  detail.id === work.planner?.id
                    ? 'Planning result'
                    : (work.steps.find(({ run }) => run?.id === detail.id)?.item.title ??
                      'Follow-up')
                }
                action={
                  <Button variant="ghost" onClick={() => setDetailId(null)}>
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
                    content={detail.result || 'No result yet.'}
                    active={isActive(detail)}
                    onOpenLink={(url) => void openExternalUrl(url)}
                  />
                </Suspense>
              )}
              <Disclosure>
                <DisclosureSummary>Activity</DisclosureSummary>
                <DisclosureBody>
                  <pre className="whitespace-pre-wrap break-words">
                    {detail.activity.join('\n')}
                  </pre>
                </DisclosureBody>
              </Disclosure>
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
            </section>
          )}
          <Disclosure>
            <DisclosureSummary>All attempts ({work.work.length})</DisclosureSummary>
            <DisclosureBody>
              {work.work.map((run) => (
                <div key={run.id}>
                  <Button variant="ghost" onClick={() => openDetails(run)}>
                    {new Date(run.startedAt).toLocaleString()} · {run.agent} · {run.status}
                  </Button>
                </div>
              ))}
            </DisclosureBody>
          </Disclosure>
          <Disclosure>
            <DisclosureSummary>Time and usage</DisclosureSummary>
            <DisclosureBody>
              {task.delivery && (
                <>
                  <dl className="managed-measurements">
                    <div>
                      <dt>Automatic repairs</dt>
                      <dd>{task.delivery.repairs.length}</dd>
                    </div>
                    <div>
                      <dt>Focused review</dt>
                      <dd>
                        {task.delivery.reviewSeconds == null
                          ? 'Not measured yet'
                          : `${Math.ceil(task.delivery.reviewSeconds / 60)} min`}
                      </dd>
                    </div>
                    <div>
                      <dt>Decisions answered</dt>
                      <dd>
                        {work.work.reduce(
                          (count, run) =>
                            count +
                            (run.prompts?.filter((prompt) => prompt.status === 'answered').length ??
                              0),
                          0,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>From work finished to applied</dt>
                      <dd>
                        {task.delivery.workersFinishedAt && task.delivery.appliedAt
                          ? `${Math.max(0, Math.ceil((Date.parse(task.delivery.appliedAt) - Date.parse(task.delivery.workersFinishedAt)) / 60000))} min`
                          : 'Not measured yet'}
                      </dd>
                    </div>
                  </dl>
                  <p className="task-muted">
                    Focused review counts time with this result visible and the window focused.
                    Elapsed delivery time includes waiting.
                  </p>
                </>
              )}
              <p>
                {usage.tokens === null
                  ? 'Usage unavailable'
                  : `${usage.tokens.toLocaleString()} reported tokens`}
                {usage.missing ? ` · ${usage.missing} reports unavailable` : ''}
                {work.missingAttempts.length > 0 ? ' · History coverage is incomplete' : ''}
              </p>
              <p>
                {usage.costUsd === null
                  ? 'Cost unavailable'
                  : `$${usage.costUsd.toFixed(4)} reported estimated cost`}
                {usage.costMissing || usage.missing || work.missingAttempts.length
                  ? ' · incomplete cost coverage'
                  : ''}
              </p>
              <p className="task-muted">
                Includes assessment, planning, worker routing and execution reports. Cached provider
                observations are counted through their parent report.
              </p>
            </DisclosureBody>
          </Disclosure>
        </DisclosureBody>
      </Disclosure>
    </WorkspacePage>
  );
}
