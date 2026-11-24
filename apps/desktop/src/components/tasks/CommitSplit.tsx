import { Button, IconButton, InlineNotice, Textarea } from '@jackalope/ui';
import { GitCommitVertical, Pencil, Split, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  applySplit,
  type CommitFile,
  commitBody,
  commitCount,
  commitFiles,
  commitTitle,
  dependencyLabel,
  type PlannedCommit,
  proposeSplit,
  type SplitProposal,
  type SplitRecovery,
  type SplitUnit,
  splitFailure,
} from '../../lib/commit-split';
import type { IntegrationPlan } from '../../lib/queue';
import './commit-split.css';

function fileDetail(file: CommitFile) {
  if (file.lock) return 'lock file, kept with its manifest';
  const lines = `+${file.added} −${file.removed}`;
  if (file.whole || file.totalHunks <= 1) return lines;
  return `${file.hunks} of ${file.totalHunks} hunks · ${lines}`;
}

function CommitList({
  commits,
  units,
  editing,
  disabled,
  onEdit,
  onMessage,
}: {
  commits: PlannedCommit[];
  units?: SplitUnit[];
  editing?: number | null;
  disabled?: boolean;
  onEdit?: (index: number | null) => void;
  onMessage?: (index: number, message: string) => void;
}) {
  const fieldId = useId();
  return (
    <ol className="commit-split-list">
      {commits.map((commit, index) => {
        const body = commitBody(commit.message);
        const needs = dependencyLabel(commit.dependsOn);
        const files = units ? commitFiles(commit, units) : [];
        const key = commit.commit ?? `${index}:${commit.hunks.join(',')}`;
        return (
          <li key={key} className="commit-split-item">
            <span className="commit-split-number" aria-hidden="true">
              {index + 1}
            </span>
            <div className="commit-split-content">
              {editing === index && onMessage ? (
                <div className="commit-split-edit">
                  <label className="task-label" htmlFor={`${fieldId}-${index}`}>
                    Message for commit {index + 1}
                  </label>
                  <Textarea
                    id={`${fieldId}-${index}`}
                    value={commit.message}
                    rows={Math.min(8, Math.max(3, commit.message.split('\n').length + 1))}
                    maxLength={4000}
                    disabled={disabled}
                    autoFocus
                    onChange={(event) => onMessage(index, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        onEdit?.(null);
                      }
                    }}
                  />
                  {!commit.message.trim() && (
                    <p className="commit-split-invalid">Every commit needs a message.</p>
                  )}
                </div>
              ) : (
                <>
                  <p className="commit-split-title">
                    <span className="ui-sr-only">Commit {index + 1}: </span>
                    {commitTitle(commit.message) || 'No message'}
                  </p>
                  {body && <p className="commit-split-body">{body}</p>}
                </>
              )}
              {commit.files.length > 0 && (
                <ul className="commit-split-files" aria-label={`Files in commit ${index + 1}`}>
                  {commit.files.map((path) => {
                    const file = files.find((file) => file.path === path);
                    return (
                      <li key={path}>
                        <span className="commit-split-path" title={path}>
                          {path}
                        </span>
                        {file && <span className="commit-split-detail">{fileDetail(file)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {(needs || commit.commit) && (
                <p className="commit-split-meta">
                  {needs}
                  {needs && commit.commit ? ' · ' : ''}
                  {commit.commit && <code>{commit.commit.slice(0, 8)}</code>}
                </p>
              )}
            </div>
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-expanded={editing === index}
                aria-label={
                  editing === index
                    ? `Done editing commit ${index + 1}`
                    : `Edit message for commit ${index + 1}`
                }
                onClick={() => onEdit(editing === index ? null : index)}
              >
                {editing === index ? (
                  'Done'
                ) : (
                  <>
                    <Pencil size={14} aria-hidden="true" />
                    Edit
                  </>
                )}
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Proposes, reviews and applies a split of a ready integration's commit. The
 * parent remounts it (by plan and head) when the integration changes.
 */
export function CommitSplit({
  plan,
  disabled,
  onBusyChange,
  onApplied,
  onRefresh,
}: {
  plan: IntegrationPlan;
  disabled?: boolean;
  /** True while merging should wait for the split. */
  onBusyChange?: (busy: boolean) => void;
  onApplied: (plan: IntegrationPlan) => Promise<void> | void;
  /** Prepares a fresh review when this one is out of date. */
  onRefresh?: () => void;
}) {
  const headingId = useId();
  const [drafting, setDrafting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proposal, setProposal] = useState<SplitProposal | null>(null);
  const [commits, setCommits] = useState<PlannedCommit[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  type Failure = { message: string; recovery: SplitRecovery } | null;
  const [error, setError] = useState<Failure>(null);
  const [applyError, setApplyError] = useState<Failure>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const busy = drafting || applying;
  const reviewing = !!proposal && commits.length > 0;
  // Merging waits while a split is drafted, open for review or being applied.
  const holding = busy || reviewing;
  const busyChange = useRef(onBusyChange);
  busyChange.current = onBusyChange;
  // Layout timing disables Merge in the same frame the split starts.
  useLayoutEffect(() => {
    busyChange.current?.(holding);
  }, [holding]);
  useEffect(() => () => busyChange.current?.(false), []);

  const applied = plan.status === 'applied';
  const existing = plan.commits ?? [];
  if (applied && existing.length === 0) return null;

  const dismiss = () => {
    setProposal(null);
    setCommits([]);
    setEditing(null);
    setError(null);
    setApplyError(null);
    requestAnimationFrame(() => startRef.current?.focus());
  };
  const propose = async () => {
    setDrafting(true);
    setError(null);
    setApplyError(null);
    setEditing(null);
    setProposal(null);
    try {
      const next = await proposeSplit(plan.id);
      setProposal(next);
      setCommits(next.commits);
      // The start button gives way to the review, so keep keyboard focus with it.
      if (next.commits.length) requestAnimationFrame(() => reviewRef.current?.focus());
    } catch (error) {
      setError(splitFailure(error));
    } finally {
      setDrafting(false);
    }
  };
  const apply = async () => {
    if (!proposal) return;
    setApplying(true);
    setApplyError(null);
    setEditing(null);
    try {
      const next = await applySplit(proposal.planId, proposal.integrationHead, commits);
      await onApplied(next);
    } catch (error) {
      setApplyError(splitFailure(error));
    } finally {
      setApplying(false);
    }
  };

  const recoveryAction = (recovery: SplitRecovery) =>
    recovery === 'propose' ? (
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void propose()}>
        Propose again
      </Button>
    ) : recovery === 'refresh' && onRefresh ? (
      <Button variant="outline" size="sm" disabled={busy || disabled} onClick={onRefresh}>
        Prepare a fresh review
      </Button>
    ) : null;
  const fileCount = plan.files.length;
  const summary = applied
    ? `Merged as ${commitCount(existing.length)}.`
    : existing.length
      ? `Split into ${commitCount(existing.length)}, building the same files.`
      : reviewing
        ? `Proposed: ${commitCount(commits.length)} building the same ${fileCount === 1 ? 'file' : `${fileCount} files`}.`
        : `One commit with ${fileCount === 1 ? 'one file' : `all ${fileCount} files`}.`;
  const invalid = commits.some((commit) => !commit.message.trim());

  return (
    <section className="commit-split" aria-labelledby={headingId}>
      <div className="commit-split-heading">
        <div>
          <h4 id={headingId}>
            <GitCommitVertical size={16} aria-hidden="true" />
            Commits
          </h4>
          <p className="task-muted">{summary}</p>
        </div>
        {!applied && !reviewing && (
          <Button
            ref={startRef}
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            loading={drafting}
            loadingLabel="Drafting split…"
            onClick={() => void propose()}
          >
            <Split size={14} aria-hidden="true" />
            {existing.length ? 'Split differently' : 'Split into commits'}
          </Button>
        )}
      </div>
      {drafting && (
        <p className="task-muted" role="status">
          Your default agent is grouping the changes. Nothing changes until you approve.
        </p>
      )}
      {error && (
        <InlineNotice
          tone="error"
          action={
            <>
              {recoveryAction(error.recovery)}
              <IconButton label="Dismiss" onClick={dismiss}>
                <X size={16} />
              </IconButton>
            </>
          }
        >
          Could not propose a split: {error.message}
        </InlineNotice>
      )}
      {proposal?.fallback && (
        <InlineNotice
          tone="info"
          role="status"
          action={
            <IconButton label="Dismiss" onClick={dismiss}>
              <X size={16} />
            </IconButton>
          }
        >
          {proposal.fallback} The integration keeps {commitCount(Math.max(existing.length, 1))}.
        </InlineNotice>
      )}
      {reviewing && proposal ? (
        <section
          ref={reviewRef}
          tabIndex={-1}
          className="commit-split-review"
          aria-label="Proposed commits"
        >
          {proposal.fileLevel && (
            <p className="task-muted">
              No file could be split by hunk, so each file moves as a whole.
            </p>
          )}
          <CommitList
            commits={commits}
            units={proposal.units}
            editing={editing}
            disabled={busy || disabled}
            onEdit={setEditing}
            onMessage={(index, message) =>
              setCommits((current) =>
                current.map((commit, at) => (at === index ? { ...commit, message } : commit)),
              )
            }
          />
          {applyError && (
            <InlineNotice tone="error" action={recoveryAction(applyError.recovery)}>
              {applyError.recovery
                ? applyError.message
                : `The split was not applied: ${applyError.message}`}
            </InlineNotice>
          )}
          <div className="commit-split-actions">
            <p className="task-muted">
              Applied only if the commits add up to exactly the reviewed files. Project attribution
              is added to each one.
            </p>
            <Button variant="outline" disabled={busy} onClick={dismiss}>
              Keep {commitCount(Math.max(existing.length, 1))}
            </Button>
            <Button
              disabled={busy || disabled || invalid}
              loading={applying}
              loadingLabel="Applying split…"
              onClick={() => void apply()}
            >
              Use {commits.length} commits
            </Button>
          </div>
        </section>
      ) : (
        existing.length > 0 && <CommitList commits={existing} />
      )}
    </section>
  );
}
