import { Checkbox, Disclosure, DisclosureSummary } from '@jackalope/ui';
import { ArrowRight, Check, GitMerge, GitPullRequest } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import type { IntegrationPlan, QueueItem } from '../../lib/queue';
import { applyIntegration, integrationPlans, prepareIntegration } from '../../lib/queue';
import type { TaskRun } from '../../lib/task-runtime';
import { taskTitle } from '../../lib/task-title';
import { mergeDestination } from '../../lib/task-workflow';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
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
  const messageId = useId();
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
  const [message, setMessage] = useState('');
  const [cleanup, setCleanup] = useState(true);
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
  const destination = mergeDestination(candidates[0] ?? { targetBranch: null }, project);
  const candidateKey = candidateIds.join();
  useEffect(() => {
    if (!onlyRunId || !candidateKey.split(',').includes(onlyRunId)) return;
    setSelected((current) => (current.includes(onlyRunId) ? current : [onlyRunId]));
  }, [onlyRunId, candidateKey]);
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
    if (isTauriEnvironment()) {
      const next = await integrationPlans();
      setPlans(next);
      if (onlyRunId)
        setPlan(
          (current) =>
            current ??
            next.find((item) => item.status === 'applied' && item.runIds.includes(onlyRunId)) ??
            null,
        );
    }
  }, [onlyRunId]);
  useEffect(() => {
    void load().catch((error) => setError(String(error)));
  }, [load]);
  const prepare = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await prepareIntegration(chosen, message);
      setPlan(next);
      setCleanup(next.commitPolicy?.cleanupAfterMerge ?? false);
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
      setPlan(await applyIntegration(plan.id, cleanup));
      setSelected([]);
      await onChanged();
      await load();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };

  const applied = plan?.status === 'applied';
  const cleaned = !!plan?.cleanupResults?.some((result) => result.removed);
  return (
    <div className="merge-review" id="task-merge">
      <div className="queue-section-heading">
        <div>
          <h2>{onlyRunId ? `Merge into ${destination}` : 'Review & merge'}</h2>
          {onlyRunId && (
            <p className="task-muted mt-2">
              Review the change, merge it into {destination}, then remove this workspace.
            </p>
          )}
        </div>
        <GitPullRequest size={26} className="text-[var(--color-accent-ink)]" />
      </div>
      {onlyRunId && (
        <ol className="merge-lifecycle">
          <li data-complete={!!plan || undefined}>Review the change</li>
          <li data-complete={applied || undefined} data-current={(!applied && !!plan) || undefined}>
            Merge into {plan?.targetBranch || destination}
          </li>
          <li data-complete={cleaned || undefined}>Remove this workspace</li>
        </ol>
      )}
      {candidates.length > 0 ? (
        <>
          {!onlyRunId && (
            <>
              <label className="queue-select-all">
                <Checkbox
                  disabled={busy}
                  checked={candidates.every((r) => chosen.includes(r.id))}
                  onChange={(e) =>
                    changeSelection(e.target.checked ? candidates.map((r) => r.id) : [])
                  }
                />
                Select all ready tasks
              </label>
              {candidates.map((run) => (
                <label className="queue-review-row" key={run.id}>
                  <Checkbox
                    disabled={busy}
                    checked={chosen.includes(run.id)}
                    onChange={(e) => {
                      changeSelection(
                        e.target.checked
                          ? [...chosen, run.id]
                          : chosen.filter((id) => id !== run.id),
                      );
                    }}
                  />
                  <span>
                    <strong>{titleFor(run.id)}</strong>
                    <small>
                      {run.agent} · {run.branch} → {mergeDestination(run, project)}
                    </small>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => useExecutionStore.getState().select(run.id)}
                  >
                    Read result
                    <ArrowRight size={13} />
                  </Button>
                </label>
              ))}
            </>
          )}
          <label htmlFor={messageId} className="task-label block mt-5">
            Commit message
            <Input
              id={messageId}
              value={message}
              maxLength={4000}
              disabled={busy}
              placeholder={chosen.length === 1 ? titleFor(chosen[0]) : 'Complete selected tasks'}
              onChange={(event) => {
                setMessage(event.target.value);
                setPlan(null);
              }}
            />
          </label>
          <Button
            className="mt-5"
            disabled={busy || !chosen.length}
            onClick={() => void prepare()}
            loading={busy}
            loadingLabel="Preparing…"
          >
            {onlyRunId
              ? `Preview merge into ${destination}`
              : `Preview ${chosen.length || ''} ${chosen.length === 1 ? 'task' : 'tasks'} together`}
            <GitMerge size={15} />
          </Button>
        </>
      ) : !plan ? (
        <p className="task-muted py-5">
          {onlyRunId
            ? 'This result is not ready to merge yet. Finish review, pass required checks, and keep the workspace available.'
            : 'Finished tasks arrive here with their results and changes.'}
        </p>
      ) : null}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
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
                {plan.runIds.length} {plan.runIds.length === 1 ? 'task' : 'tasks'} →{' '}
                {plan.targetBranch}
              </h3>
              <p className="task-muted mt-2">
                {plan.files.length} {plan.files.length === 1 ? 'file' : 'files'} · starting at{' '}
                {plan.masterHead.slice(0, 8)}
              </p>
              <ul className="task-muted mt-2">
                {plan.runIds.map((id) => (
                  <li key={id}>{titleFor(id)}</li>
                ))}
              </ul>
            </div>
            {plan.status === 'applied' && <Check size={24} />}
          </div>
          {plan.commitMessage && (
            <div className="my-4">
              <p className="task-label">Commit preview</p>
              <pre className="whitespace-pre-wrap break-words task-muted mt-2">
                {plan.commitMessage}
              </pre>
              <p className="task-muted mt-2">
                Attribution:{' '}
                {plan.commitPolicy?.attribution === 'agent'
                  ? 'Agents'
                  : `${plan.commitPolicy?.name} <${plan.commitPolicy?.email}>`}
              </p>
            </div>
          )}
          {!!plan.cleanupResults?.length && (
            <div role="status" className="task-notice merge-cleanup-results">
              <p>
                Merged into {plan.targetBranch}
                {plan.cleanupResults.every((result) => result.removed)
                  ? '. The task workspace was removed.'
                  : '. The workspace is still here if you need it.'}
              </p>
              <ul>
                {plan.cleanupResults.map((result) => (
                  <li key={result.workspace} className="break-all">
                    {result.removed ? 'Removed workspace and local branch' : 'Kept for attention'}:{' '}
                    {result.workspace}
                    {result.error ? ` · ${result.error}` : ''}
                  </li>
                ))}
              </ul>
              {plan.cleanupResults.some((result) => !result.removed) && (
                <Button variant="outline" disabled={busy} onClick={() => void apply()}>
                  Retry cleanup
                </Button>
              )}
            </div>
          )}
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
            <InlineNotice>
              A selected task changed or was integrated elsewhere. Prepare a fresh review before
              merging.
            </InlineNotice>
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
                Creates one commit on {plan.targetBranch}. That checkout must be clean, and the
                reviewed files must still match. Publishing remains a separate step.
              </p>
              <label className="flex items-center gap-3 min-h-11">
                <Checkbox
                  checked={cleanup}
                  disabled={busy}
                  onChange={(event) => setCleanup(event.target.checked)}
                />
                Remove this workspace after merging
              </label>
              <Button
                disabled={busy}
                onClick={() => void apply()}
                loading={busy}
                loadingLabel="Merging…"
              >
                {cleanup
                  ? `Merge into ${plan.targetBranch} and clean up`
                  : `Merge into ${plan.targetBranch}`}
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
        <Disclosure className="mt-7">
          <DisclosureSummary className="task-summary">
            Previous integration reviews
          </DisclosureSummary>
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
        </Disclosure>
      )}
    </div>
  );
}
