import { isActive, isDone, isRetryable, statusLabel } from '@jackalope/contracts/runs';
import {
  Badge,
  Button,
  ConfirmDialog,
  Disclosure,
  DisclosureSummary,
  InlineNotice,
  LoadingState,
  DropdownMenu as Menu,
  SegmentedNav,
  Select,
  SelectItem,
} from '@jackalope/ui';
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Clock3,
  FileInput,
  GitMerge,
  GitPullRequest,
  Layers3,
  ListPlus,
  LoaderCircle,
  MoreHorizontal,
  Pause,
  Play,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ownerComputer } from '../../lib/computers';
import { isTauriEnvironment } from '../../lib/native/env';
import {
  type QueueCommand,
  type QueueItem,
  type QueueView,
  queueCommand,
  queueSnapshot,
} from '../../lib/queue';
import { stopTask } from '../../lib/task-client';
import { useFeatureTelemetry } from '../../lib/use-feature-telemetry';
import { useExecutionStore } from '../../stores/executionStore';
import type { Project } from '../../stores/projectStore';
import { AgentAvatar } from '../agents/AgentAvatar';
import { AddWork } from './AddWork';
import { CoordinationAutomation } from './CoordinationAutomation';
import { CoordinationDecisions } from './CoordinationDecisions';
import { FeatureGraphView } from './FeatureGraphView';
import { FeaturePlanner } from './FeaturePlanner';
import { MergeReview } from './MergeReview';
import { PlanImport } from './PlanImport';
import './project-queue.css';
import { describeError } from '@jackalope/contracts/errors';
import { useAction } from '../../hooks/useAction';
import { ActionError } from '../ui/ActionError';

const emptyQueue: QueueView = {
  items: [],
  messages: [],
  enabledProjects: [],
  concurrency: 3,
  remoteConcurrency: 8,
  bridgeUrl: null,
  bridgeError: null,
  mergedRunIds: [],
};

export function ProjectQueue({ project, onBack }: { project: Project; onBack: () => void }) {
  useFeatureTelemetry('queue');
  const { runs, select, refresh } = useExecutionStore(
    useShallow((s) => ({ runs: s.runs, select: s.select, refresh: s.refresh })),
  );
  const [queue, setQueue] = useState<QueueView>(emptyQueue);
  const [adding, setAdding] = useState(false);
  const [planningFeature, setPlanningFeature] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState('plan');
  const [filter, setFilter] = useState('all');
  const {
    run: runAction,
    busy,
    error,
    setError,
  } = useAction(async () => {
    await load();
    await refresh();
  });
  const [loading, setLoading] = useState(true);
  const [onComputer, setOnComputer] = useState(false);
  const desktop = isTauriEnvironment();
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    ownerComputer({ kind: 'project', id: project.id })
      .then((computer) => !disposed && setOnComputer(!!computer))
      .catch(() => !disposed && setOnComputer(false));
    return () => {
      disposed = true;
    };
  }, [desktop, project.id]);
  const remoteConcurrency = queue.remoteConcurrency ?? 8;
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
        if (!disposed) setError(describeError(error));
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
  }, [desktop, setError]);
  const items = queue.items.filter((i) => i.projectId === project.id && !i.canceled);
  const enabled = queue.enabledProjects.includes(project.id);
  const act = (command: QueueCommand, args: Record<string, unknown>) =>
    runAction(() => queueCommand(command, args));
  const state = (item: QueueItem) => {
    const original = runs.find((r) => r.id === item.runId);
    const run = original ? runs.find((r) => r.taskId === original.taskId) : undefined;
    if (item.runId && queue.mergedRunIds.includes(item.runId)) return 'merged';
    if (item.error || run?.dependencyInvalidated || (run && isRetryable(run))) return 'attention';
    if (run && isActive(run)) return 'active';
    if (run && isDone(run)) return 'review';
    if (item.runId) return 'attention';
    return 'queued';
  };
  const reason = (item: QueueItem) => {
    if (
      queue.scopeAudits?.some(
        (a) =>
          a.projectId === project.id &&
          (a.error || a.overlaps.length || (a.outside.length && a.tree !== a.acceptedTree)),
      )
    )
      return 'Waiting for a changed-file scope review in Coordination & handoffs';
    if (
      queue.agreements?.some(
        (a) =>
          a.projectId === project.id &&
          a.kind === 'interface' &&
          ['pending', 'rejected'].includes(a.status),
      )
    )
      return 'Check interface decisions in Coordination & handoffs';
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
        <div className="task-home-actions">
          <Button disabled={!desktop} onClick={() => setPlanningFeature(true)}>
            Write the plan myself
          </Button>
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="outline" aria-label="More feature work actions" disabled={!desktop}>
                <MoreHorizontal size={18} />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content className="workspace-menu" align="end" sideOffset={8}>
                <Menu.Item className="workspace-menu-item" onSelect={() => setAdding(true)}>
                  <ListPlus size={16} aria-hidden="true" />
                  Add work
                </Menu.Item>
                <Menu.Item className="workspace-menu-item" onSelect={() => setImporting(true)}>
                  <FileInput size={16} aria-hidden="true" />
                  Import a plan
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
      {planningFeature && (
        <FeaturePlanner project={project} onClose={() => setPlanningFeature(false)} />
      )}
      {[...new Set(items.filter((i) => i.feature).map((i) => i.featureId ?? i.feature))].map(
        (featureId) => {
          const steps = items.filter((i) => (i.featureId ?? i.feature) === featureId);
          const feature = steps[0]?.feature;
          const integrated = steps.filter((i) => state(i) === 'merged').length;
          const attention = steps.filter((i) => state(i) === 'attention').length;
          return (
            <InlineNotice key={featureId} className="my-3">
              {feature} · {integrated} of {steps.length} tasks integrated
              {attention ? ` · ${attention} need attention` : ''}
              {integrated === steps.length ? ' · Plan integrated; check the combined feature.' : ''}
            </InlineNotice>
          );
        },
      )}
      <SegmentedNav
        className="queue-tabs"
        label="Feature work views"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'plan', label: 'Plan & progress' },
          { id: 'graph', label: 'Execution graph' },
          {
            id: 'review',
            label: 'Review & merge',
            count: items.filter((i) => state(i) === 'review').length || undefined,
          },
        ]}
      />
      {!desktop && (
        <InlineNotice>
          Open the desktop app to coordinate agents and review real changes.
        </InlineNotice>
      )}
      {(error || queue.bridgeError) && (
        <InlineNotice tone="error">{error || queue.bridgeError}</InlineNotice>
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
            <div className="queue-limits">
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
              {onComputer && (
                <label htmlFor="projectqueue-remote-limit" className="task-label">
                  <span className="inline-flex items-center gap-2">
                    On computers <Badge variant="accent">Beta</Badge>
                  </span>
                  <Select
                    id="projectqueue-remote-limit"
                    aria-label="Concurrent tasks on computers"
                    className="task-input"
                    value={String(remoteConcurrency)}
                    disabled={busy || !desktop}
                    onValueChange={(value) =>
                      void act('queue_dispatch', {
                        projectId: project.id,
                        enabled,
                        concurrency: queue.concurrency,
                        remoteConcurrency: Number(value),
                      })
                    }
                  >
                    {[...new Set([1, 2, 4, 8, 12, 16, 24, 32, remoteConcurrency])]
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} at once
                        </SelectItem>
                      ))}
                  </Select>
                </label>
              )}
            </div>
            <Button
              disabled={
                !desktop ||
                busy ||
                (!items.some((i) => state(i) === 'queued') &&
                  !queue.assistPolicies?.some(
                    (p) => p.projectId === project.id && (p.resolve || p.merge),
                  ) &&
                  !enabled)
              }
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
              <Button disabled={!desktop} onClick={() => setAdding(true)}>
                <ListPlus size={16} />
                Add the first task
              </Button>
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
                    <AgentAvatar
                      provider={item.agent}
                      working={phase === 'active'}
                      waiting={
                        phase === 'attention' &&
                        !!run?.prompts?.some((prompt) => prompt.status === 'pending')
                      }
                      size="sm"
                    />
                    <div className="queue-item-body">
                      <div className="queue-item-title">
                        <h3>{item.title}</h3>
                        {phase !== 'merged' && (
                          <Badge appearance="plain" className="task-status">
                            {item.error
                              ? 'Needs attention'
                              : run
                                ? statusLabel[run.status]
                                : 'Queued'}
                          </Badge>
                        )}
                      </div>
                      {item.scopes.length > 0 && (
                        <p className="task-muted text-xs">{item.scopes.join(', ')}</p>
                      )}
                      {phase === 'queued' && <p className="queue-wait">{reason(item)}</p>}
                      <ActionError error={item.error} />
                      <Disclosure className="mt-2">
                        <DisclosureSummary className="task-summary">Task brief</DisclosureSummary>
                        <p className="queue-brief">{item.prompt}</p>
                      </Disclosure>
                      <div className="queue-item-actions">
                        {run && (
                          <Button variant="outline" size="sm" onClick={() => select(run.id)}>
                            {isActive(run) ? 'Follow work' : 'Read result'}
                            <ArrowRight size={13} />
                          </Button>
                        )}
                        {phase === 'attention' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void act('queue_release', { id: item.id, retry: true })}
                          >
                            Retry in a new worktree
                          </Button>
                        )}
                        {phase !== 'merged' &&
                          (run && isActive(run) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void runAction(() => stopTask(run.id))}
                            >
                              Stop agent
                            </Button>
                          ) : (
                            <ConfirmDialog
                              trigger={
                                <Button variant="ghost" size="sm" disabled={busy}>
                                  {item.runId ? 'Abandon' : 'Remove'}
                                </Button>
                              }
                              title={
                                item.runId
                                  ? `Abandon ${item.title}?`
                                  : `Remove ${item.title} from the plan?`
                              }
                              description={
                                item.runId
                                  ? 'It leaves the plan and the files it reserved are released for other work. Its attempt and worktree are kept.'
                                  : 'It leaves the plan before any agent starts on it.'
                              }
                              label={item.runId ? 'Abandon and release scope' : 'Remove from plan'}
                              busyLabel={item.runId ? 'Releasing…' : 'Removing…'}
                              onConfirm={async () => {
                                await (item.runId
                                  ? act('queue_release', { id: item.id, retry: false })
                                  : act('queue_cancel', { id: item.id }));
                              }}
                            />
                          ))}
                      </div>
                    </div>
                  </article>
                );
              })
          )}
          <CoordinationAutomation
            project={project}
            queue={queue}
            busy={busy || !desktop}
            act={act}
            onSelect={select}
          />
          <section className="queue-coordination">
            <h2 className="text-base font-medium">
              Coordination & handoffs
              {queue.messages.filter((m) => m.projectId === project.id).length
                ? ` · ${queue.messages.filter((m) => m.projectId === project.id).length} messages`
                : ''}
            </h2>
            {!queue.bridgeUrl && <p className="task-muted mt-4">Coordination unavailable.</p>}
            <CoordinationDecisions
              queue={queue}
              projectId={project.id}
              runs={runs}
              busy={busy}
              act={act}
            />
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
