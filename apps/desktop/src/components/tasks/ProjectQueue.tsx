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
import { Select, SelectItem } from '../ui/Select';
import { AddWork } from './AddWork';
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
    if (item.error || (run && ['failed', 'stopped', 'interrupted'].includes(run.status)))
      return 'attention';
    if (run && isActive(run)) return 'active';
    if (run && ['review', 'reviewed'].includes(run.status)) return 'review';
    if (item.runId) return 'attention';
    return 'queued';
  };
  const reason = (item: QueueItem) => {
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
            {tab === 'review' ? 'Review & merge' : 'Parallel work'}
          </h1>
          {!items.length && (
            <p className="task-muted mt-3">Independent tasks. Shared progress. One review.</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-3">
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
      <nav className="queue-tabs" aria-label="Parallel work views">
        <button aria-pressed={tab === 'plan'} type="button" onClick={() => setTab('plan')}>
          Plan & progress
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
      ) : (
        <>
          <div className="queue-controls">
            <label htmlFor="projectqueue-field-2" className="task-label">
              Concurrent agents
              <Select
                id="projectqueue-field-2"
                aria-label="Concurrent agents"
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
            <p className="task-muted py-6" role="status">
              Loading your plan…
            </p>
          ) : items.length === 0 ? (
            <div className="queue-empty">
              <ListPlus size={28} />
              <h2>Start with independent pieces</h2>
              <p className="task-muted">
                Give each task an agent and a clear set of files. Add dependencies for work that
                must follow another change.
              </p>
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
          <details className="supporting-details">
            <summary>Workspace and dispatch rules</summary>
            <p>
              Tasks start from committed {project.preferences?.baseBranch || project.gitBranch}.
              Commit any local changes the agents need. Restarting Jackalope pauses dispatch.
              Pausing leaves current work running.
            </p>
          </details>
          <details className="queue-coordination">
            <summary className="task-summary">
              Coordination & handoffs
              {queue.messages.filter((m) => m.projectId === project.id).length
                ? ` · ${queue.messages.filter((m) => m.projectId === project.id).length} messages`
                : ''}
            </summary>
            <p className="task-muted mt-4">
              {queue.bridgeUrl
                ? 'Local bridge is available. Each running task receives temporary access to this project’s assignments and messages.'
                : 'The local coordination bridge is not available.'}{' '}
              Claims belong to Jackalope; worker notes do not complete or merge tasks.
            </p>
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
                </div>
              ))}
          </details>
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
