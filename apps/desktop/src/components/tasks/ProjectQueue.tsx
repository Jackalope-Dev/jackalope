import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Clock3,
  GitMerge,
  GitPullRequest,
  Layers3,
  ListPlus,
  LoaderCircle,
  Pause,
  Play,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type QueueCommand,
  type QueueItem,
  type QueueView,
  queueCommand,
  queueSnapshot,
} from '../../lib/queue';
import { isActive, nativeTask, statusLabel } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { telemetry } from '../../stores/communityStore';
import { useExecutionStore } from '../../stores/executionStore';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { AddWork } from './AddWork';
import { FeatureGraphView } from './FeatureGraphView';
import { FeaturePlanner } from './FeaturePlanner';
import { MergeReview } from './MergeReview';
import { PlanImport } from './PlanImport';
import './project-queue.css';

const emptyQueue: QueueView = {
  items: [],
  messages: [],
  enabledProjects: [],
  concurrency: 3,
  bridgeUrl: null,
  bridgeError: null,
  mergedRunIds: [],
};

export function ProjectQueue({ project, onBack }: { project: Project; onBack: () => void }) {
  useEffect(() => {
    telemetry.track({ name: 'feature_used', feature: 'queue' });
  }, []);
  const { runs, select, refresh } = useExecutionStore();
  const [queue, setQueue] = useState<QueueView>(emptyQueue);
  const [adding, setAdding] = useState(false);
  const [planningFeature, setPlanningFeature] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState('plan');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const desktop = isTauriEnvironment();
  const load = async () => {
    if (desktop) setQueue(await queueSnapshot());
    setLoading(false);
  };
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (desktop) {
          const result = await queueSnapshot();
          if (!disposed) setQueue(result);
        }
      } catch (error) {
        if (!disposed) setError(String(error));
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(poll, 2000);
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [desktop]);
  const items = queue.items.filter((i) => i.projectId === project.id && !i.canceled);
  const enabled = queue.enabledProjects.includes(project.id);
  const act = async (command: QueueCommand | 'task_stop', args: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      if (command === 'task_stop') await nativeTask(command, args);
      else await queueCommand(command, args);
      await load();
      await refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const state = (item: QueueItem) => {
    const original = runs.find((r) => r.id === item.runId);
    const run = original ? runs.find((r) => r.taskId === original.taskId) : undefined;
    if (item.runId && queue.mergedRunIds.includes(item.runId)) return 'merged';
    if (
      item.error ||
      run?.dependencyInvalidated ||
      (run && ['failed', 'stopped', 'interrupted'].includes(run.status))
    )
      return 'attention';
    if (run && isActive(run)) return 'active';
    if (run && ['review', 'reviewed'].includes(run.status)) return 'review';
    if (item.runId) return 'attention';
    return 'queued';
  };
  const reason = (item: QueueItem) => {
    if (item.stagedDependencies && item.dependencies.length)
      return 'Waiting for verified predecessor snapshots and an available slot';
    const dep = item.dependencies.find(
      (id) => !queue.mergedRunIds.includes(queue.items.find((i) => i.id === id)?.runId ?? ''),
    );
    if (dep)
      return `Waits for ${queue.items.find((i) => i.id === dep)?.title ?? 'dependency'} to merge`;
    const overlap = items.find(
      (other) =>
        other.id !== item.id &&
        other.runId &&
        !queue.mergedRunIds.includes(other.runId) &&
        item.scopes.some((a) =>
          other.scopes.some(
            (b) =>
              a === '.' || b === '.' || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`),
          ),
        ),
    );
    return overlap
      ? `Shared scope · waits for ${overlap.title}`
      : enabled
        ? 'Waiting for an available slot'
        : 'Ready when you start the plan';
  };
  return (
    <section className="task-page queue-page">
      <button type="button" className="task-back" onClick={onBack}>
        <ArrowLeft size={15} />
        All tasks
      </button>
      <div className={`queue-heading ${items.length ? 'queue-heading-active' : ''}`}>
        <div>
          <h1 className="task-hero-title">
            {tab === 'review' ? 'Review & merge' : 'Feature work'}
          </h1>
        </div>
        <div className="flex flex-col items-end gap-3">
          <Button disabled={!desktop} onClick={() => setPlanningFeature(true)}>
            Plan a feature
          </Button>
          <Button variant="outline" disabled={!desktop} onClick={() => setAdding(true)}>
            <ListPlus size={16} />
            Add work
          </Button>
          <button
            type="button"
            className="task-link"
            disabled={!desktop}
            onClick={() => setImporting(true)}
          >
            Import a plan
          </button>
        </div>
      </div>
      {planningFeature && (
        <FeaturePlanner
          project={project}
          onClose={() => setPlanningFeature(false)}
          onAdded={load}
        />
      )}
      {[...new Set(items.filter((i) => i.feature).map((i) => i.featureId ?? i.feature))].map(
        (featureId) => {
          const steps = items.filter((i) => (i.featureId ?? i.feature) === featureId);
          const feature = steps[0]?.feature;
          const integrated = steps.filter((i) => state(i) === 'merged').length;
          const attention = steps.filter((i) => state(i) === 'attention').length;
          return (
            <p key={featureId} className="task-notice my-3">
              {feature} · {integrated} of {steps.length} tasks integrated
              {attention ? ` · ${attention} need attention` : ''}
              {integrated === steps.length ? ' · Plan integrated; check the combined feature.' : ''}
            </p>
          );
        },
      )}
      <nav className="queue-tabs" aria-label="Feature work views">
        <button aria-pressed={tab === 'plan'} type="button" onClick={() => setTab('plan')}>
          Plan & progress
        </button>
        <button aria-pressed={tab === 'graph'} type="button" onClick={() => setTab('graph')}>
          Execution graph
        </button>
        <button aria-pressed={tab === 'review'} type="button" onClick={() => setTab('review')}>
          Review & merge
          {items.filter((i) => state(i) === 'review').length > 0 && (
            <span>{items.filter((i) => state(i) === 'review').length}</span>
          )}
        </button>
      </nav>
      {!desktop && (
        <p className="task-notice">
          Open the desktop app to coordinate agents and review real changes.
        </p>
      )}
      {(error || queue.bridgeError) && (
        <p className="task-error" role="alert">
          {error || queue.bridgeError}
        </p>
      )}
      {tab === 'review' ? (
        <MergeReview
          key={project.id}
          project={project}
          runs={runs}
          items={items}
          merged={queue.mergedRunIds}
          onChanged={load}
        />
      ) : tab === 'graph' ? (
        <FeatureGraphView
          items={items}
          mergedRunIds={queue.mergedRunIds}
          onSelectRun={(runId) => {
            select(runId);
          }}
        />
      ) : (
        <>
          <div className="queue-controls">
            <label htmlFor="projectqueue-field-2" className="task-label">
              Concurrent tasks
              <Select
                id="projectqueue-field-2"
                aria-label="Concurrent tasks"
                className="task-input"
                value={String(queue.concurrency)}
                disabled={busy || !desktop}
                onValueChange={(value) =>
                  void act('queue_dispatch', {
                    projectId: project.id,
                    enabled,
                    concurrency: Number(value),
                  })
                }
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} across projects
                  </SelectItem>
                ))}
              </Select>
            </label>
            <Button
              disabled={!desktop || busy || (!items.some((i) => state(i) === 'queued') && !enabled)}
              onClick={() =>
                void act('queue_dispatch', {
                  projectId: project.id,
                  enabled: !enabled,
                  concurrency: queue.concurrency,
                })
              }
            >
              {enabled ? <Pause size={15} /> : <Play size={15} />}
              {enabled ? 'Pause dispatch' : 'Run ready tasks'}
            </Button>
          </div>
          <p className="task-muted text-xs">
            {enabled
              ? 'Dispatch is on. Ready tasks start automatically as dependencies merge.'
              : 'Dispatch is paused. Start ready tasks when your plan is set.'}
          </p>

          <fieldset className="queue-flow">
            <legend className="sr-only">Filter by progress</legend>
            {(
              [
                ['all', 'All work', Layers3],
                ['queued', 'Queued', Clock3],
                ['active', 'Working', LoaderCircle],
                ['review', 'Review', GitPullRequest],
                ['merged', 'Merged', GitMerge],
                ['attention', 'Attention', CircleAlert],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
                <strong>
                  {value === 'all' ? items.length : items.filter((i) => state(i) === value).length}
                </strong>
              </button>
            ))}
          </fieldset>
          {loading ? (
            <LoadingState label="Loading your plan…" />
          ) : items.length === 0 ? (
            <div className="queue-empty">
              <ListPlus size={28} />
              <h2>Start with independent pieces</h2>
              <p className="task-muted">Assign agents, files and dependencies to each task.</p>
              <button
                type="button"
                className="task-link"
                disabled={!desktop}
                onClick={() => setAdding(true)}
              >
                Add the first task
                <ArrowRight size={15} />
              </button>
            </div>
          ) : (
            items
              .filter((i) => filter === 'all' || state(i) === filter)
              .map((item, index) => {
                const original = runs.find((r) => r.id === item.runId);
                const run = original ? runs.find((r) => r.taskId === original.taskId) : undefined;
                const phase = state(item);
                return (
                  <article className="queue-item" key={item.id}>
                    <span className="queue-number">{String(index + 1).padStart(2, '0')}</span>
                    <div className="queue-item-body">
                      <div className="queue-item-title">
                        <h3>{item.title}</h3>
                        <span className="task-status">
                          {phase === 'merged'
                            ? 'Integrated'
                            : item.error
                              ? 'Needs attention'
                              : run
                                ? statusLabel[run.status]
                                : 'Queued'}
                        </span>
                      </div>
                      <p className="task-muted text-xs">
                        {item.agent} · {item.scopes.join(', ')}
                      </p>
                      {phase === 'queued' && <p className="queue-wait">{reason(item)}</p>}
                      {item.error && <p className="task-error">{item.error}</p>}
                      <details className="mt-2">
                        <summary className="task-summary">Task brief</summary>
                        <p className="queue-brief">{item.prompt}</p>
                      </details>
                      <div className="queue-item-actions">
                        {run ? (
                          <button
                            type="button"
                            className="task-link"
                            onClick={() => select(run.id)}
                          >
                            {isActive(run) ? 'Follow work' : 'Read result'}
                            <ArrowRight size={13} />
                          </button>
                        ) : (
                          !item.runId && (
                            <button
                              type="button"
                              className="task-link"
                              disabled={busy}
                              onClick={() => void act('queue_cancel', { id: item.id })}
                            >
                              Remove from plan
                            </button>
                          )
                        )}
                        {phase === 'attention' && (
                          <button
                            type="button"
                            className="task-link"
                            disabled={busy}
                            onClick={() => void act('queue_release', { id: item.id, retry: true })}
                          >
                            Retry in a new worktree
                          </button>
                        )}
                        {item.runId && (!run || !isActive(run)) && phase !== 'merged' && (
                          <button
                            type="button"
                            className="task-link"
                            disabled={busy}
                            onClick={() => void act('queue_release', { id: item.id, retry: false })}
                          >
                            Abandon & release scope
                          </button>
                        )}
                        {run && isActive(run) && (
                          <button
                            type="button"
                            className="task-link"
                            disabled={busy}
                            onClick={() => void act('task_stop', { id: run.id })}
                          >
                            Stop agent
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
          )}
          <p className="task-muted text-sm my-4">
            Tasks start from committed {project.preferences?.baseBranch || project.gitBranch}.
            Pausing or restarting stops new dispatches.
          </p>
          <section className="queue-coordination">
            <h2 className="text-base font-medium">
              Coordination & handoffs
              {queue.messages.filter((m) => m.projectId === project.id).length
                ? ` · ${queue.messages.filter((m) => m.projectId === project.id).length} messages`
                : ''}
            </h2>
            {!queue.bridgeUrl && <p className="task-muted mt-4">Coordination unavailable.</p>}
            {queue.messages
              .filter((m) => m.projectId === project.id)
              .slice(-30)
              .reverse()
              .map((m) => (
                <div className="queue-message" key={m.id}>
                  <small>
                    {items.find((i) => i.id === m.taskId)?.title ?? 'Task'} · {m.kind} ·{' '}
                    {new Date(m.createdAt).toLocaleTimeString()}
                  </small>
                  <p>{m.text}</p>
                  {m.resolvedBy && <span className="task-muted"> · Resolved</span>}
                  {m.report && (
                    <div className="task-muted">
                      <p>Completed: {m.report.completed.join('; ') || 'None reported'}</p>
                      <p>Remaining: {m.report.remaining.join('; ') || 'None reported'}</p>
                      <p>Artifacts: {m.report.artifacts.join(', ') || 'None reported'}</p>
                      <p>Agent report · Snapshot {m.sourceTree?.slice(0, 12) ?? 'unavailable'}</p>
                    </div>
                  )}
                  <small>
                    {m.recipientTaskId
                      ? `To ${items.find((item) => item.id === m.recipientTaskId)?.title ?? 'task'}`
                      : 'Project broadcast'}{' '}
                    ·{' '}
                    {m.acknowledgedBy?.length
                      ? `Read by ${m.acknowledgedBy.length} task(s)`
                      : 'No acknowledgment yet'}
                  </small>
                </div>
              ))}
          </section>
        </>
      )}
      {importing && (
        <PlanImport
          project={project}
          enabled={enabled}
          onAdded={load}
          onClose={() => setImporting(false)}
        />
      )}
      {adding && (
        <AddWork
          project={project}
          items={items}
          enabled={enabled}
          onAdded={load}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}
