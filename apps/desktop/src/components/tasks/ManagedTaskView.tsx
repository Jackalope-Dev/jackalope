import { Disclosure, DisclosureSummary, Textarea } from '@jackalope/ui';
import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { FeatureStep } from '../../lib/feature-plan';
import {
  type ManagedTask,
  managedTaskCommand,
  managedTaskWork,
  previewTaskPlan,
} from '../../lib/managed-task';
import { queueCommand } from '../../lib/queue';
import { isActive, type TaskRun } from '../../lib/task-runtime';
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
import { MergeReview } from './MergeReview';
import { UserPromptCard } from './UserPromptCard';

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
  const [reviewing, setReviewing] = useState(false);
  const detail = work.work.find((run) => run.id === detailId);
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
  useEffect(() => {
    if (detailId) select(detailId);
    return () => select(null);
  }, [detailId, select]);
  const usage = summarizeUsage([
    ...usageEntries(work.work),
    ...(task.assessment.cached ? [] : [{ usage: task.assessment.decision.usage }]),
  ]);
  const openDetails = (run: TaskRun) => {
    setDetailId(run.id);
    setReviewing(false);
  };
  const continueRun = async (run: TaskRun) => {
    if (!correction.trim()) return;
    await managedTaskCommand('action', { id: task.id, action: 'pause' });
    const id = await start(
      {
        ...task.request,
        agent: run.agent,
        model: run.model ?? undefined,
        agentProfileId: run.accountBinding?.profileId ?? '__default',
        previousRunId: run.id,
        prompt: correction.trim(),
      },
      { background: true },
    );
    setCorrection('');
    setDetailId(id);
  };
  return (
    <WorkspacePage className="managed-task">
      <Button
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
      />
      {(error || queueError || (task.error && !work.planner)) && (
        <InlineNotice tone="error">{error || queueError || task.error}</InlineNotice>
      )}
      {work.missingAttempts.length > 0 && (
        <InlineNotice tone="warning">
          {work.missingAttempts.length} saved attempts are not loaded. History and usage are
          incomplete. Restore archived attempts or reload history to inspect them.
        </InlineNotice>
      )}
      <div className="flex flex-wrap gap-2 mb-4">
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
        {work.ready && !work.integrated && (
          <Button
            onClick={() => {
              setDetailId(null);
              setReviewing(true);
              void act(() => managedTaskCommand('action', { id: task.id, action: 'pause' }));
            }}
          >
            Review combined changes
          </Button>
        )}
        <Button variant="ghost" onClick={() => void act(refreshAll)} disabled={busy}>
          Refresh
        </Button>
      </div>
      {work.questions.map(({ run, prompt }) => (
        <UserPromptCard key={prompt.id} runId={run.id} prompt={prompt} active />
      ))}
      <Disclosure className="mb-4">
        <DisclosureSummary>Request and decision</DisclosureSummary>
        <p className="whitespace-pre-wrap">{task.request.prompt}</p>
        <p>{task.assessment.reason}</p>
        {task.assessment.cached && <p>Assessment reused; no additional assessment call.</p>}
        {task.assessment.decision.fallbackReason && (
          <p>{task.assessment.decision.fallbackReason}</p>
        )}
      </Disclosure>
      {!task.started && (
        <>
          <h2 className="task-section-title">Proposed work</h2>
          {work.planner && isActive(work.planner) && (
            <p className="task-muted" role="status">
              The lead is checking repository boundaries and preparing assignments. Implementation
              has not started.
            </p>
          )}
          {plan.map((step, index) => (
            <Disclosure key={step.key} className="py-3 border-b border-[var(--color-border)]">
              <DisclosureSummary>
                {index + 1}. {step.title}
              </DisclosureSummary>
              <p className="task-muted">
                {step.dependsOn.length
                  ? `After: ${step.dependsOn.map((key) => plan.find((entry) => entry.key === key)?.title ?? key).join(', ')}`
                  : 'Can start independently'}
              </p>
              <p>Owns: {step.scopes.join(', ')}</p>
              <p className="whitespace-pre-wrap">{step.prompt.split('\n\nComplete request')[0]}</p>
            </Disclosure>
          ))}
          {!!plan.length && (
            <div className="my-4">
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
              <p className="task-muted mt-2">
                Workers inherit this task’s agent, account, model and tools. Dependencies use
                verified changes; the target branch remains unchanged until review.
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
            <Button variant="ghost" onClick={() => openDetails(work.planner as TaskRun)}>
              Planning result and corrections
            </Button>
          )}
        </>
      )}
      {task.started && (
        <section aria-label="Work in this task" className="space-y-3">
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
                        void act(() => queueCommand('queue_release', { id: item.id, retry: true }))
                      }
                    >
                      Retry assignment
                    </Button>
                  )}
              </div>
            </div>
          ))}
        </section>
      )}
      {detail && (
        <section aria-label="Assignment details" className="my-5 space-y-3">
          <h2 className="task-section-title">
            {detail.id === work.planner?.id
              ? 'Planning result'
              : (work.steps.find(({ run }) => run?.id === detail.id)?.item.title ?? 'Follow-up')}
          </h2>
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
            <pre className="whitespace-pre-wrap break-words">{detail.activity.join('\n')}</pre>
          </Disclosure>
          {!isActive(detail) && !work.integrated && !work.active.length && (
            <>
              {['failed', 'stopped'].includes(detail.status) && detail.id === work.planner?.id && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await managedTaskCommand('action', { id: task.id, action: 'retry-plan' });
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
      {reviewing && project && (
        <MergeReview
          project={project}
          runs={runs}
          items={work.items}
          merged={queue.mergedRunIds}
          onChanged={refreshAll}
          onlyRunIds={work.steps.flatMap(({ run }) => (run ? [run.id] : []))}
        />
      )}
      <Disclosure className="mt-5">
        <DisclosureSummary>All attempts ({work.work.length})</DisclosureSummary>
        {work.work.map((run) => (
          <div key={run.id}>
            <Button variant="ghost" onClick={() => openDetails(run)}>
              {new Date(run.startedAt).toLocaleString()} · {run.agent} · {run.status}
            </Button>
          </div>
        ))}
      </Disclosure>
      <Disclosure className="mt-5">
        <DisclosureSummary>Usage across this task</DisclosureSummary>
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
      </Disclosure>
    </WorkspacePage>
  );
}
