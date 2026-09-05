import { useDialogFocus } from '../ui/useDialogFocus';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CircleAlert,
  Clock3,
  Layers3,
  LoaderCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  GitMerge,
  GitPullRequest,
  ListPlus,
  Pause,
  Play,
  Plus,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { isActive, nativeTask, statusLabel, type TaskRun } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { PlanImport } from './PlanImport';
import './project-queue.css';

interface QueueItem {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  agent: string;
  scopes: string[];
  dependencies: string[];
  runId: string | null;
  error: string | null;
  canceled: boolean;
}
interface QueueMessage {
  id: string;
  taskId: string;
  projectId: string;
  kind: string;
  text: string;
  createdAt: string;
}
interface QueueView {
  items: QueueItem[];
  messages: QueueMessage[];
  enabledProjects: string[];
  concurrency: number;
  bridgeUrl: string | null;
  bridgeError: string | null;
  mergedRunIds: string[];
}
interface IntegrationPlan {
  id: string;
  projectPath: string;
  masterHead: string;
  integrationHead: string | null;
  runIds: string[];
  files: string[];
  patch: string;
  conflicts: string[];
  status: string;
  createdAt: string;
  appliedAt: string | null;
}
const emptyQueue: QueueView = {
  items: [],
  messages: [],
  enabledProjects: [],
  concurrency: 3,
  bridgeUrl: null,
  bridgeError: null,
  mergedRunIds: [],
};

function AddWork({
  project,
  items,
  enabled,
  onAdded,
  onClose,
}: {
  enabled: boolean;
  project: Project;
  items: QueueItem[];
  onAdded: () => Promise<void>;
  onClose: () => void;
}) {
  const dialogFocus = useDialogFocus();
  const { runners } = useExecutionStore();
  const key = `jackalope-plan-draft:${project.id}`;
  const [draft, setDraft] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(key) || 'null') ?? {
          title: '',
          prompt: '',
          agent: 'codex',
          scopes: '',
          dependencies: [],
        }
      );
    } catch {
      return { title: '', prompt: '', agent: 'codex', scopes: '', dependencies: [] };
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (value: Partial<typeof draft>) => {
    const next = { ...draft, ...value };
    setDraft(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await nativeTask('queue_add', {
        request: {
          ...draft,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          scopes: draft.scopes
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean),
        },
      });
      update({ title: '', prompt: '', scopes: '', dependencies: [] });
      await onAdded();
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content {...dialogFocus} className="task-dialog queue-dialog glass-panel">
          <Dialog.Title className="task-title">A clear piece of work</Dialog.Title>
          <Dialog.Description className="task-muted mt-3">
            Give one agent a focused scope. Add dependencies when it needs another task’s changes
            first. {enabled && 'Dispatch is on: this task may start as soon as you add it.'}
          </Dialog.Description>
          <Dialog.Close className="task-close" aria-label="Close task editor" disabled={busy}>
            <X size={18} />
          </Dialog.Close>
          <form
            className="queue-form"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <label>
              Task title
              <input
                className="task-input"
                value={draft.title}
                maxLength={160}
                required
                onChange={(e) => update({ title: e.target.value })}
                placeholder="Make interrupted work recoverable"
              />
            </label>
            <label>
              What should be delivered?
              <textarea
                className="task-input"
                rows={4}
                required
                value={draft.prompt}
                onChange={(e) => update({ prompt: e.target.value })}
                placeholder="Describe the outcome, constraints, and how to verify it."
              />
            </label>
            <div className="queue-form-pair">
              <label>
                Agent
                <select
                  className="task-input"
                  value={draft.agent}
                  onChange={(e) => update({ agent: e.target.value })}
                >
                  {['codex', 'claude', 'grok'].map((id) => (
                    <option key={id} value={id}>
                      {id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex' : 'Grok'}
                      {runners.find((r) => r.id === id)?.available ? '' : ' · not detected'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Owned files or folders
                <input
                  className="task-input"
                  required
                  value={draft.scopes}
                  onChange={(e) => update({ scopes: e.target.value })}
                  placeholder="src/recovery, docs/recovery.md"
                />
              </label>
            </div>
            <p className="task-muted text-xs">
              Separate paths with commas. Shared scopes wait for integration. Scope is an agent
              instruction, not a filesystem sandbox.
            </p>
            {items.some((i) => !i.canceled) && (
              <fieldset>
                <legend className="task-label mb-2">Wait for these tasks to merge</legend>
                <div className="queue-dependencies">
                  {items
                    .filter((i) => !i.canceled)
                    .map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={draft.dependencies.includes(item.id)}
                          onChange={(e) =>
                            update({
                              dependencies: e.target.checked
                                ? [...draft.dependencies, item.id]
                                : draft.dependencies.filter((id: string) => id !== item.id),
                            })
                          }
                        />
                        {item.title}
                      </label>
                    ))}
                </div>
              </fieldset>
            )}
            {error && (
              <p className="task-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add to plan'}
              <Plus size={15} />
            </Button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MergeReview({
  project,
  runs,
  items,
  merged,
  onChanged,
}: {
  project: Project;
  runs: TaskRun[];
  items: QueueItem[];
  merged: string[];
  onChanged: () => Promise<void>;
}) {
  const titleFor = (id: string) => {
    const run = runs.find((run) => run.id === id);
    const item = items.find((item) =>
      runs.some((original) => original.id === item.runId && original.taskId === run?.taskId),
    );
    return item?.title ?? run?.prompt.split('\n')[0] ?? id;
  };
  const [selected, setSelected] = useState<string[]>([]);
  const [plans, setPlans] = useState<IntegrationPlan[]>([]);
  const [plan, setPlan] = useState<IntegrationPlan | null>(null);
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const normalizePath = (path: string) =>
    path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  const candidates = runs.filter(
    (r) =>
      r.projectId === project.id &&
      ['review', 'reviewed'].includes(r.status) &&
      r.workspace &&
      normalizePath(r.workspace) !== normalizePath(r.projectPath) &&
      !merged.includes(r.id) &&
      !runs.some((other) => other.taskId === r.taskId && other.startedAt > r.startedAt),
  );
  const candidateIds = candidates.map((run) => run.id);
  const chosen = selected.filter((id) => candidateIds.includes(id));
  const changeSelection = (next: string[]) => {
    setSelected(next);
    setPlan(null);
    setFile('');
    setError('');
  };
  const planEligible =
    plan &&
    (plan.status === 'applied' ||
      plan.status === 'applying' ||
      plan.runIds.every((id) => candidateIds.includes(id)));
  const load = useCallback(async () => {
    if (isTauriEnvironment()) setPlans(await nativeTask<IntegrationPlan[]>('integration_plans'));
  }, []);
  useEffect(() => {
    void load().catch((error) => setError(String(error)));
  }, [load]);
  const prepare = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await nativeTask<IntegrationPlan>('integration_prepare', { runIds: chosen });
      setPlan(next);
      setFile('');
      await load();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      setPlan(await nativeTask<IntegrationPlan>('integration_apply', { planId: plan.id }));
      setSelected([]);
      await onChanged();
      await load();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const chunks = plan?.patch.split(/(?=^diff --git )/m) ?? [];
  const decodePath = (value: string): string | undefined => {
    if (!value.startsWith('"')) return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };
  const fileChunks = file
    ? chunks.filter((chunk) => {
        const lines = chunk.split('\n');
        const paths = lines
          .filter((line) => line.startsWith('+++ ') || line.startsWith('--- '))
          .map((line) => decodePath(line.slice(4)))
          .filter((path): path is string => path !== undefined);
        if (paths.some((path) => path === `a/${file}` || path === `b/${file}`)) return true;
        const header = lines[0];
        return (
          header === `diff --git a/${file} b/${file}` ||
          header.startsWith(`diff --git a/${file} b/`) ||
          header.endsWith(` b/${file}`)
        );
      })
    : [];
  const showingFullPatch = Boolean(file && fileChunks.length === 0 && plan?.patch);
  const patch = file && fileChunks.length ? fileChunks.join('') : plan?.patch;
  return (
    <div className="merge-review">
      <div className="queue-section-heading">
        <div>
          <h2>Bring the work together</h2>
          <p className="task-muted mt-2">
            Review the combined changes before updating master. Your source worktrees stay intact.
          </p>
        </div>
        <GitPullRequest size={26} className="text-[var(--color-accent-ink)]" />
      </div>
      {candidates.length > 0 ? (
        <>
          <label className="queue-select-all">
            <input
              type="checkbox"
              disabled={busy}
              checked={candidates.every((r) => chosen.includes(r.id))}
              onChange={(e) => changeSelection(e.target.checked ? candidates.map((r) => r.id) : [])}
            />
            Select all ready tasks
          </label>
          {candidates.map((run) => (
            <label className="queue-review-row" key={run.id}>
              <input
                type="checkbox"
                disabled={busy}
                checked={chosen.includes(run.id)}
                onChange={(e) => {
                  changeSelection(
                    e.target.checked ? [...chosen, run.id] : chosen.filter((id) => id !== run.id),
                  );
                }}
              />
              <span>
                <strong>{titleFor(run.id)}</strong>
                <small>
                  {run.agent} · {run.branch}
                </small>
              </span>
              <button
                type="button"
                className="task-link"
                onClick={() => useExecutionStore.getState().select(run.id)}
              >
                Read result
                <ArrowRight size={13} />
              </button>
            </label>
          ))}
          <Button className="mt-5" disabled={busy || !chosen.length} onClick={() => void prepare()}>
            {busy
              ? 'Preparing…'
              : `Preview ${chosen.length || ''} ${chosen.length === 1 ? 'task' : 'tasks'} together`}
            <GitMerge size={15} />
          </Button>
        </>
      ) : (
        <p className="task-muted py-5">
          Finished tasks arrive here with their results and changes.
        </p>
      )}
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <section className="merge-preview" aria-label="Combined change review">
          <div className="queue-section-heading">
            <div>
              <p className="task-eyebrow">
                {plan.status === 'applied'
                  ? 'Integrated into master'
                  : plan.status === 'conflicted'
                    ? 'Conflicts need attention'
                    : 'Review this integration'}
              </p>
              <h3>{plan.runIds.length} tasks → master</h3>
              <p className="task-muted mt-2">
                {plan.files.length} files · starting at {plan.masterHead.slice(0, 8)}
              </p>
              <ul className="task-muted mt-2">
                {plan.runIds.map((id) => (
                  <li key={id}>{titleFor(id)}</li>
                ))}
              </ul>
            </div>
            {plan.status === 'applied' && <Check size={24} />}
          </div>
          {plan.conflicts.length > 0 && (
            <div className="task-error">
              <p>
                These tasks cannot be combined automatically. Continue an affected task to resolve
                the overlap, then prepare a new review.
              </p>
              <ul className="mt-2">
                {plan.conflicts.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          )}
          {!planEligible && (
            <p className="task-notice">
              A selected task changed or was integrated elsewhere. Prepare a fresh review before
              merging.
            </p>
          )}
          {showingFullPatch && (
            <p className="task-notice">
              This file could not be isolated in the text preview. Showing all changes so nothing is
              hidden.
            </p>
          )}
          <div className="merge-patch-layout">
            <nav aria-label="Changed files">
              <button className={!file ? 'selected' : ''} type="button" onClick={() => setFile('')}>
                All changes
              </button>
              {plan.files.map((name) => (
                <button
                  className={file === name ? 'selected' : ''}
                  type="button"
                  key={name}
                  onClick={() => setFile(name)}
                >
                  {name}
                </button>
              ))}
            </nav>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The diff scroll area needs keyboard scrolling. */}
            <section className="merge-patch" tabIndex={0} aria-label="Integration diff">
              <pre>
                {patch
                  ? patch
                      .split('\n')
                      .map((line, index) => ({ line, id: `${plan.id}-${file}-${index}` }))
                      .map(({ line, id }) => (
                        <span
                          key={id}
                          className={
                            line.startsWith('+')
                              ? 'patch-added'
                              : line.startsWith('-')
                                ? 'patch-removed'
                                : line.startsWith('@@')
                                  ? 'patch-context'
                                  : ''
                          }
                        >
                          {line}
                          {'\n'}
                        </span>
                      ))
                  : 'No text changes to display. Binary files are listed separately.'}
              </pre>
            </section>
          </div>
          {planEligible && ['ready', 'applying'].includes(plan.status) && (
            <div className="merge-approval">
              <p className="task-muted">
                Creates commits as your configured Git user and fast-forwards master. Master must be
                clean, and the reviewed source files must still match. Build and test the changes
                before merging.
              </p>
              <Button disabled={busy} onClick={() => void apply()}>
                {busy
                  ? 'Integrating…'
                  : `Merge ${plan.runIds.length} ${plan.runIds.length === 1 ? 'task' : 'tasks'} into master`}
                <GitMerge size={15} />
              </Button>
            </div>
          )}
        </section>
      )}
      {plans.filter(
        (p) =>
          p.projectPath.replaceAll('\\', '/').toLowerCase() ===
          project.path.replaceAll('\\', '/').toLowerCase(),
      ).length > 0 && (
        <details className="mt-7">
          <summary className="task-summary">Previous integration reviews</summary>
          {plans
            .filter(
              (p) =>
                p.projectPath.replaceAll('\\', '/').toLowerCase() ===
                project.path.replaceAll('\\', '/').toLowerCase(),
            )
            .map((p) => (
              <button
                type="button"
                className="queue-history"
                key={p.id}
                onClick={() => {
                  setPlan(p);
                  setFile('');
                }}
              >
                {p.runIds.length} tasks · {new Date(p.createdAt).toLocaleString()}
                <span>{p.status === 'applied' ? 'Merged' : p.status}</span>
              </button>
            ))}
        </details>
      )}
    </div>
  );
}

export function ProjectQueue({ project, onBack }: { project: Project; onBack: () => void }) {
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
    if (desktop) setQueue(await nativeTask<QueueView>('queue_snapshot'));
    setLoading(false);
  };
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (desktop) {
          const result = await nativeTask<QueueView>('queue_snapshot');
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
  const act = async (command: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await nativeTask(command, args);
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
            <label className="task-label">
              Concurrent agents
              <select
                className="task-input"
                value={queue.concurrency}
                disabled={busy || !desktop}
                onChange={(e) =>
                  void act('queue_dispatch', {
                    projectId: project.id,
                    enabled,
                    concurrency: Number(e.target.value),
                  })
                }
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} across projects
                  </option>
                ))}
              </select>
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
                            ? 'Merged into master'
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
              Tasks start from committed master. Commit any local changes the agents need.
              Restarting Jackalope pauses dispatch. Pausing leaves current work running.
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
