import { ArrowRight, Check, GitMerge, GitPullRequest } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { IntegrationPlan, QueueItem } from '../../lib/queue';
import { applyIntegration, integrationPlans, prepareIntegration } from '../../lib/queue';
import type { TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { DiffPreview } from './DiffPreview';
export function MergeReview({
  project,
  runs,
  items,
  merged,
  onChanged,
  onlyRunId,
}: {
  onlyRunId?: string;
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
    return item?.title ?? (run ? taskTitle(run.prompt) : id);
  };
  const [selected, setSelected] = useState<string[]>(onlyRunId ? [onlyRunId] : []);
  const [plans, setPlans] = useState<IntegrationPlan[]>([]);
  const [plan, setPlan] = useState<IntegrationPlan | null>(null);
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const normalizePath = (path: string) =>
    path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  const candidates = runs.filter(
    (r) =>
      (!onlyRunId || r.id === onlyRunId) &&
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
    if (isTauriEnvironment()) setPlans(await integrationPlans());
  }, []);
  useEffect(() => {
    void load().catch((error) => setError(String(error)));
  }, [load]);
  const prepare = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await prepareIntegration(chosen);
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
      setPlan(await applyIntegration(plan.id));
      setSelected([]);
      await onChanged();
      await load();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="merge-review">
      <div className="queue-section-heading">
        <div>
          <h2>{onlyRunId ? 'Review result' : 'Review & merge'}</h2>
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
                  ? `Integrated into ${plan.targetBranch}`
                  : plan.status === 'conflicted'
                    ? 'Conflicts need attention'
                    : 'Review this integration'}
              </p>
              <h3>
                {plan.runIds.length} tasks → {plan.targetBranch}
              </h3>
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
            <DiffPreview patch={plan.patch} file={file} />
          </div>
          {planEligible && ['ready', 'applying'].includes(plan.status) && (
            <div className="merge-approval">
              <p className="task-muted">
                Creates commits as your configured Git user and fast-forwards {plan.targetBranch}.
                The target checkout must be clean, and the reviewed source files must still match.
                Build and test the changes before merging.
              </p>
              <Button disabled={busy} onClick={() => void apply()}>
                {busy
                  ? 'Integrating…'
                  : `Merge ${plan.runIds.length} ${plan.runIds.length === 1 ? 'task' : 'tasks'} into ${plan.targetBranch}`}
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
