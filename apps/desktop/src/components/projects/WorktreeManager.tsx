import { Badge, type BadgeProps, IconButton, RefreshIcon } from '@jackalope/ui';
import {
  Archive,
  Copy,
  FolderGit2,
  FolderX,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  HardDrive,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import {
  archiveWorktree,
  cleanupWorktree,
  isTauriEnvironment,
  listWorktreeOrphans,
  pruneWorktrees,
  removeWorktreeOrphan,
  type WorktreeEntry,
  type WorktreeOrphan,
} from '../../lib/tauri-bridge';
import { openChanges } from '../../stores/commitReviewStore';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { EmptyState } from '../ui/EmptyState';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';

/** Ignored paths cleanup deletes, so a confirm never hides them. */
function discarded(worktrees: WorktreeEntry[]): string[] {
  return [...new Set(worktrees.flatMap((wt) => wt.cleanup?.discarded_paths ?? []))].sort();
}

const isReady = (wt: WorktreeEntry) =>
  Boolean((wt.cleanup?.merged || wt.cleanup?.content_merged) && !wt.cleanup.blocked_reason);

/** One plain-language status per worktree, so the row reads at a glance. */
function worktreeStatus(
  wt: WorktreeEntry,
  checking: boolean,
): { label: string; variant: BadgeProps['variant'] } {
  if (wt.cleanup?.missing) return { label: 'Folder missing', variant: 'warning' };
  if (wt.is_locked) return { label: 'Locked', variant: 'outline' };
  if (isReady(wt)) return { label: 'Merged', variant: 'success' };
  if (wt.cleanup?.recoverable) return { label: 'Uncommitted changes', variant: 'warning' };
  if (!wt.cleanup && checking) return { label: 'Checking…', variant: 'outline' };
  return { label: 'In progress', variant: 'accent' };
}

/** Paths inside the project show relative to it; the full path stays in the tooltip. */
function displayPath(path: string, root?: string) {
  if (!root) return path;
  const base = root.replace(/[\\/]+$/, '');
  return path.startsWith(base) && path.length > base.length ? path.slice(base.length + 1) : path;
}

/**
 * What a confirm is about to remove, and which step it is on once it runs:
 * removing several worktrees is slow enough to look stalled without it.
 */
function RemovalPlan({
  names = [],
  paths = [],
  progress,
  busy = false,
  busyNote,
  isFolder = false,
}: {
  names?: string[];
  paths?: string[];
  progress?: string;
  busy?: boolean;
  busyNote?: string;
  isFolder?: boolean;
}) {
  if (busy) {
    return (
      <div className="cleanup-plan-busy" role="status" aria-live="polite">
        <LoadingState label={progress || 'Cleaning up…'} compact />
        <p className="task-muted text-xs">
          {busyNote || 'Removing files and Git branches. This may take a moment…'}
        </p>
      </div>
    );
  }

  if (names.length < 2 && !paths.length) return null;

  const Icon = isFolder ? FolderX : GitBranch;

  return (
    <div className="cleanup-plan">
      {names.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <p className="cleanup-plan-heading">
            {isFolder ? 'Folders' : 'Worktrees'} to remove ({names.length}):
          </p>
          <ul className="cleanup-plan-list">
            {names.map((name) => (
              <li key={name} className="cleanup-plan-item font-mono text-xs">
                <Icon
                  size={14}
                  className="shrink-0 text-[var(--color-text-muted)]"
                  aria-hidden="true"
                />
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {paths.length > 0 && (
        <details className="cleanup-plan-note">
          <summary>Ignored files deleted too ({paths.length})</summary>
          <p className="font-mono text-xs break-all">{paths.join(', ')}</p>
        </details>
      )}
    </div>
  );
}

export function WorktreeManager({ onOpenProject }: { onOpenProject: () => void }) {
  const {
    projects,
    activeProjectId,
    loadWorktreesForActiveProject,
    spawnTaskWorktree,
    loading,
    checkingWorktrees,
    worktreesError,
  } = useProjectStore();
  const project = projects.find((p) => p.id === activeProjectId);
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState('');
  const [branch, setBranch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [target, setTarget] = useState('auto');
  const [removing, setRemoving] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const pending = busy || removing !== null;
  const refreshing = loading || checkingWorktrees;
  const worktrees = (project?.worktrees ?? []).filter(
    (wt, index) => index > 0 && !['main', 'master'].includes(wt.branch),
  );
  const ready = worktrees.filter(isReady);
  const active = worktrees.filter((wt) => !isReady(wt));
  const missing = worktrees.filter((wt) => wt.cleanup?.missing && !wt.is_locked);
  const [orphans, setOrphans] = useState<WorktreeOrphan[]>([]);
  const leftover = orphans.filter((folder) => !folder.blocked_reason);
  const targetBranch = target === 'auto' ? undefined : target;
  const projectId = useRef(activeProjectId);
  const refreshButton = useRef<HTMLButtonElement>(null);
  projectId.current = activeProjectId;
  useEffect(() => {
    if (!loading && !pending && feedback.startsWith('Removed ')) refreshButton.current?.focus();
  }, [feedback, loading, pending]);
  const branchName = branch ?? `feat/${slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const desktop = isTauriEnvironment();
  const projectPath = project?.path;
  const [sizes, setSizes] = useState<
    Record<string, { bytes: number; files: number; partial: boolean; skippedLinks: number }>
  >({});
  const [measuring, setMeasuring] = useState('');
  const measure = async (path: string) => {
    if (!projectPath || measuring) return;
    setMeasuring(path);
    try {
      const value = await nativeTask<{
        bytes: number;
        files: number;
        partial: boolean;
        skippedLinks: number;
      }>('git_worktree_usage', { repoPath: projectPath, worktreePath: path });
      setSizes((previous) => ({ ...previous, [path]: value }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setMeasuring('');
    }
  };
  // Leftover folders are not registered worktrees, so Git never reports them
  // with the list above; they are read separately.
  const loadOrphans = useCallback(async () => {
    const id = projectId.current;
    if (!projectPath) return setOrphans([]);
    try {
      const found = await listWorktreeOrphans(projectPath);
      if (projectId.current === id) setOrphans(found);
    } catch {
      if (projectId.current === id) setOrphans([]);
    }
  }, [projectPath]);
  const refresh = useCallback(async () => {
    await Promise.all([loadWorktreesForActiveProject(targetBranch), loadOrphans()]);
  }, [loadWorktreesForActiveProject, loadOrphans, targetBranch]);
  useEffect(() => {
    setError('');
    setFeedback('');
    if (activeProjectId) void refresh();
  }, [refresh, activeProjectId]);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (creating) nameInput.current?.focus();
  }, [creating]);
  const create = async () => {
    if (busy || !project || !slug.trim()) return;
    setBusy(true);
    setError('');
    setFeedback('');
    const result = await spawnTaskWorktree(slug.trim(), branchName.trim());
    setBusy(false);
    if (result.ok) {
      await refresh();
      setCreating(false);
      setSlug('');
      setBranch(null);
      setFeedback('Worktree created.');
    } else setError(result.error);
  };
  const cleanup = async (worktree: WorktreeEntry) => {
    if (pending || !project) return;
    const id = project.id;
    const name = worktree.branch || worktree.path;
    setRemoving(worktree.path);
    setError('');
    setFeedback('');
    setProgress(`Removing ${name}…`);
    try {
      await cleanupWorktree(project.path, worktree);
      if (projectId.current === id) setFeedback(`Removed ${name}.`);
    } catch (cause) {
      if (projectId.current === id)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (projectId.current === id) {
        setProgress('Rechecking the other worktrees…');
        await refresh();
      }
      setProgress('');
      setRemoving(null);
    }
  };
  const archive = async (worktree: WorktreeEntry) => {
    if (!project) return;
    const id = project.id;
    setRemoving(worktree.path);
    setError('');
    setFeedback('');
    setProgress(`Saving ${worktree.branch || worktree.path} to the archive…`);
    try {
      const location = await archiveWorktree(project.path, worktree);
      if (projectId.current === id) setFeedback(`Archived to ${location}, then removed it.`);
    } finally {
      // The confirm dialog surfaces any error; just refresh the list either way.
      if (projectId.current === id) {
        setProgress('Rechecking the other worktrees…');
        await refresh();
      }
      setProgress('');
      setRemoving(null);
    }
  };
  const cleanupMerged = async () => {
    if (pending || !project || !ready.length) return;
    const id = project.id;
    const candidates = [...ready];
    setBusy(true);
    setError('');
    setFeedback('');
    let removed = 0;
    try {
      const failures: string[] = [];
      for (const [index, worktree] of candidates.entries()) {
        setProgress(
          `Removing ${worktree.branch || worktree.path}… (${index + 1} of ${candidates.length})`,
        );
        try {
          await cleanupWorktree(project.path, worktree);
          removed++;
        } catch (cause) {
          failures.push(`${worktree.branch || worktree.path}: ${String(cause)}`);
        }
      }
      if (failures.length && projectId.current === id) setError(failures.join('\n'));
    } catch (cause) {
      if (projectId.current === id)
        setError(`Cleanup stopped. ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      if (projectId.current === id) {
        setFeedback(`Removed ${removed} of ${candidates.length} worktrees.`);
        setProgress('Rechecking the remaining worktrees…');
        await refresh();
      }
      setProgress('');
      setBusy(false);
    }
  };
  const prune = async () => {
    if (pending || !project) return;
    const id = project.id;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const dropped = await pruneWorktrees(project.path);
      if (projectId.current === id)
        setFeedback(
          dropped > 0
            ? `Removed ${dropped} missing ${dropped === 1 ? 'entry' : 'entries'}. No folders or branches were deleted.`
            : 'No missing entries to remove.',
        );
    } catch (cause) {
      if (projectId.current === id)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (projectId.current === id) await refresh();
      setBusy(false);
    }
  };
  const removeLeftover = async (folders: WorktreeOrphan[]) => {
    if (pending || !project || !folders.length) return;
    const id = project.id;
    setBusy(true);
    setError('');
    setFeedback('');
    let removed = 0;
    const failures: string[] = [];
    for (const [index, folder] of folders.entries()) {
      setProgress(`Deleting ${folder.name}… (${index + 1} of ${folders.length})`);
      try {
        await removeWorktreeOrphan(project.path, folder);
        removed++;
      } catch (cause) {
        failures.push(`${folder.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    if (projectId.current === id) {
      if (failures.length) setError(failures.join('\n'));
      setFeedback(
        `Deleted ${removed} of ${folders.length} leftover ${folders.length === 1 ? 'folder' : 'folders'}.`,
      );
      setProgress('Rechecking the project folder…');
      await refresh();
    }
    setProgress('');
    setBusy(false);
  };
  const copy = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setFeedback(`Copied: ${path}`);
      setError('');
    } catch {
      setError(`Could not copy. Select the path in the list and copy it manually: ${path}`);
    }
  };
  const renderWorktree = (wt: WorktreeEntry) => {
    const status = worktreeStatus(wt, checkingWorktrees);
    return (
      <article key={wt.path} className="worktree-row">
        <span className="worktree-icon" data-variant={status.variant} aria-hidden="true">
          <GitBranch size={18} />
        </span>
        <div className="worktree-identity">
          <h3>
            <span className="truncate">
              {wt.branch || (wt.is_bare ? 'Bare repository' : 'Detached HEAD')}
            </span>
            <Badge variant={status.variant}>{status.label}</Badge>
          </h3>
          <p className="worktree-path" title={wt.path}>
            {displayPath(wt.path, projectPath)}
          </p>
          {sizes[wt.path] && (
            <p
              className="task-muted"
              title="Git data and linked folders excluded. File sizes may differ from allocated disk space."
            >
              {sizes[wt.path].partial ? 'At least ' : ''}
              {(sizes[wt.path].bytes / 1024 / 1024).toFixed(1)} MiB in{' '}
              {sizes[wt.path].files.toLocaleString()} files
            </p>
          )}
          <div className="worktree-meta">
            <span className="font-mono">
              {wt.head ? wt.head.slice(0, 7) : 'No resolved commit'}
            </span>
            {wt.is_locked && !wt.cleanup?.missing && (
              <span>
                <Lock size={14} aria-hidden="true" />
                Locked
              </span>
            )}
            {wt.is_bare && <span>Bare repository</span>}
            <span
              className={
                wt.cleanup?.merged && !wt.cleanup.missing ? 'text-[var(--color-success)]' : ''
              }
            >
              <GitMerge size={14} aria-hidden="true" />
              {wt.cleanup?.missing
                ? 'Folder missing'
                : wt.cleanup?.content_merged
                  ? `Content already in ${wt.cleanup.target_branch}`
                  : wt.cleanup?.merged === true
                    ? `Commits merged into ${wt.cleanup.target_branch}`
                    : wt.cleanup?.merged === false
                      ? `Not merged into ${wt.cleanup.target_branch}`
                      : checkingWorktrees
                        ? 'Checking merge status…'
                        : 'Merge status unavailable'}
            </span>
          </div>
          {wt.cleanup?.blocked_reason && (
            <p className="task-muted mt-2">{wt.cleanup.blocked_reason}</p>
          )}
        </div>
        <div className="workspace-actions">
          {(wt.cleanup?.merged || wt.cleanup?.content_merged) && !wt.cleanup.blocked_reason && (
            <ConfirmAction
              title={`Clean up ${wt.branch || 'worktree'}?`}
              description={`Removes this worktree folder and local branch. Changes are already merged into ${wt.cleanup.target_branch}.`}
              label="Remove worktree & branch"
              busyLabel="Removing…"
              onConfirm={() => cleanup(wt)}
              trigger={
                <Button
                  variant="outline"
                  disabled={refreshing || pending || !desktop}
                  aria-label={`Remove worktree ${wt.branch || wt.path}`}
                  loading={removing === wt.path}
                  loadingLabel="Removing…"
                >
                  <Trash2 size={18} aria-hidden="true" />
                  Remove worktree &amp; branch
                </Button>
              }
            >
              {({ busy }) => (
                <RemovalPlan
                  busy={busy}
                  paths={discarded([wt])}
                  progress={progress}
                  busyNote={`Removing ${wt.branch || wt.path}. This may take a moment…`}
                />
              )}
            </ConfirmAction>
          )}
          {wt.cleanup?.recoverable && (
            <ConfirmAction
              title={`Archive and remove ${wt.branch || 'worktree'}?`}
              description="Saves uncommitted work to .worktrees/.archive, then removes the folder and branch."
              label="Archive & remove"
              busyLabel="Archiving…"
              onConfirm={() => archive(wt)}
              trigger={
                <Button
                  variant="outline"
                  disabled={refreshing || pending || !desktop}
                  aria-label={`Archive and remove ${wt.branch || wt.path}`}
                  loading={removing === wt.path}
                  loadingLabel="Archiving…"
                >
                  <Archive size={18} aria-hidden="true" />
                  Archive &amp; remove
                </Button>
              }
            >
              {({ busy }) => (
                <RemovalPlan
                  busy={busy}
                  progress={progress}
                  busyNote="Archiving uncommitted work and removing folder. This may take a moment…"
                />
              )}
            </ConfirmAction>
          )}
          <Button
            variant="ghost"
            disabled={!!wt.cleanup?.missing}
            aria-label={`Review changes in ${wt.branch || wt.path}`}
            onClick={() => openChanges(wt.path)}
          >
            <GitCommitHorizontal size={18} aria-hidden="true" />
            Changes
          </Button>
          <IconButton
            variant="ghost"
            label={
              measuring === wt.path
                ? 'Measuring…'
                : `${sizes[wt.path] ? 'Refresh' : 'Check'} disk size of ${wt.branch || wt.path}`
            }
            title={sizes[wt.path] ? 'Refresh disk size' : 'Check disk size'}
            disabled={!!measuring || !desktop || !!wt.cleanup?.missing}
            onClick={() => void measure(wt.path)}
          >
            <HardDrive size={18} />
          </IconButton>
          <IconButton
            variant="ghost"
            label={`Copy path for ${wt.branch || wt.path}`}
            title="Copy path"
            onClick={() => void copy(wt.path)}
          >
            <Copy size={18} />
          </IconButton>
        </div>
      </article>
    );
  };
  return (
    <WorkspacePage className="">
      <WorkspaceHeading
        title="Worktrees"
        action={
          project && (
            <div className="workspace-actions">
              <IconButton
                variant="ghost"
                label="Refresh worktrees"
                ref={refreshButton}
                title="Refresh worktrees"
                disabled={refreshing || pending || !desktop}
                onClick={() => void refresh()}
              >
                <RefreshIcon size={20} />
              </IconButton>
              <Button
                aria-expanded={creating}
                aria-controls="worktree-create"
                disabled={pending || !desktop}
                onClick={() => setCreating(!creating)}
              >
                <Plus size={18} />
                New worktree
              </Button>
            </div>
          )
        }
      />
      {error && (
        <InlineNotice tone="error" className="worktree-notice">
          {error}
        </InlineNotice>
      )}
      <div role="status">
        {feedback && (
          <InlineNotice tone="success" className="worktree-notice break-all">
            {feedback}
          </InlineNotice>
        )}
      </div>
      {!project ? (
        <EmptyState
          icon={FolderGit2}
          title="Choose a project"
          description="Open a repository to see its branches and workspaces."
          action={
            <Button onClick={onOpenProject}>
              <FolderGit2 size={18} />
              Open project
            </Button>
          }
        />
      ) : (
        <>
          <div className="worktree-summary">
            <p className="task-muted">
              Worktrees are separate checkouts of this repository, so tasks can work on their own
              branch in parallel without touching your main folder.
            </p>
            <div className="worktree-summary-bar">
              <dl className="worktree-counts">
                <div>
                  <dt>In progress</dt>
                  <dd>{active.length}</dd>
                </div>
                <div data-tone={ready.length ? 'success' : undefined}>
                  <dt>Ready to clean up</dt>
                  <dd>{ready.length}</dd>
                </div>
                {orphans.length > 0 && (
                  <div data-tone="warning">
                    <dt>Leftover folders</dt>
                    <dd>{orphans.length}</dd>
                  </div>
                )}
              </dl>
              <label className="worktree-target" htmlFor="worktree-target">
                Merged into
                <Select
                  id="worktree-target"
                  value={target}
                  onValueChange={setTarget}
                  disabled={pending || !desktop}
                >
                  <SelectItem value="auto">Auto · main / master</SelectItem>
                  <SelectItem value="main">main</SelectItem>
                  <SelectItem value="master">master</SelectItem>
                </Select>
              </label>
            </div>
          </div>
          {creating && (
            <form
              id="worktree-create"
              className="worktree-form"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <div className="worktree-fields">
                <label htmlFor="worktree-name">
                  Folder name
                  <Input
                    id="worktree-name"
                    ref={nameInput}
                    value={slug}
                    disabled={pending}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="search-improvements"
                  />
                </label>
                <label htmlFor="worktree-branch">
                  Branch
                  <Input
                    id="worktree-branch"
                    value={branchName}
                    disabled={pending}
                    onChange={(e) => setBranch(e.target.value)}
                    className="font-mono"
                  />
                </label>
                <Button
                  type="submit"
                  disabled={pending || !slug.trim() || !branchName.trim()}
                  loading={busy}
                  loadingLabel="Creating…"
                >
                  <GitBranch size={18} />
                  Create worktree
                </Button>
              </div>
            </form>
          )}
          {loading && <LoadingState label="Loading worktrees…" compact={!!worktrees.length} />}
          {checkingWorktrees && <LoadingState label="Checking merge and cleanup status…" compact />}
          {worktreesError && <InlineNotice tone="error">{worktreesError}</InlineNotice>}
          {active.length > 0 && (
            <section className="worktree-group" aria-labelledby="worktrees-active">
              <header className="worktree-group-heading">
                <div>
                  <h2 id="worktrees-active">In progress</h2>
                  <p className="task-muted">Branches not merged yet, or with work still open.</p>
                </div>
                {missing.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || refreshing || !desktop}
                    onClick={() => void prune()}
                  >
                    Forget missing folders ({missing.length})
                  </Button>
                )}
              </header>
              {active.map(renderWorktree)}
            </section>
          )}
          {ready.length > 0 && (
            <section className="worktree-group" aria-labelledby="worktrees-ready">
              <header className="worktree-group-heading">
                <div>
                  <h2 id="worktrees-ready">Ready to clean up</h2>
                  <p className="task-muted">
                    Merged with no uncommitted changes. Removing them keeps task history.
                  </p>
                </div>
                <ConfirmAction
                  title={`Clean up ${ready.length} ready worktrees?`}
                  description="Removes merged worktrees and local branches. Task history is kept."
                  label="Clean up ready"
                  busyLabel="Cleaning up…"
                  onConfirm={cleanupMerged}
                  trigger={
                    <Button size="sm" disabled={pending || refreshing || !desktop || !ready.length}>
                      <Trash2 size={16} aria-hidden="true" />
                      Clean up all ({ready.length})
                    </Button>
                  }
                >
                  {({ busy }) => (
                    <RemovalPlan
                      busy={busy}
                      names={ready.map((wt) => wt.branch || wt.path)}
                      paths={discarded(ready)}
                      progress={progress}
                    />
                  )}
                </ConfirmAction>
              </header>
              {ready.map(renderWorktree)}
            </section>
          )}
          {!loading && !worktreesError && !worktrees.length && (
            <EmptyState
              icon={GitBranch}
              title="A place for parallel work"
              description="Create a worktree here, or let a new task create one automatically."
            />
          )}
          {orphans.length > 0 && (
            <section className="worktree-group" aria-labelledby="worktrees-leftover">
              <header className="worktree-group-heading">
                <div>
                  <h2 id="worktrees-leftover">Leftover folders</h2>
                  <p className="task-muted">Folders in .worktrees/ that Git no longer tracks.</p>
                </div>
                {leftover.length > 0 && (
                  <ConfirmAction
                    title={`Delete ${leftover.length} leftover ${leftover.length === 1 ? 'folder' : 'folders'}?`}
                    description="These folders in .worktrees/ are no longer tracked by Git. Deleting them cannot be undone."
                    label="Delete leftover folders"
                    busyLabel="Deleting…"
                    onConfirm={() => removeLeftover(leftover)}
                    trigger={
                      <Button size="sm" disabled={pending || refreshing || !desktop}>
                        <FolderX size={16} aria-hidden="true" />
                        Delete all ({leftover.length})
                      </Button>
                    }
                  >
                    {({ busy }) => (
                      <RemovalPlan
                        busy={busy}
                        names={leftover.map((folder) => folder.name)}
                        progress={progress}
                        busyNote="Deleting leftover folders. This may take a moment…"
                        isFolder
                      />
                    )}
                  </ConfirmAction>
                )}
              </header>
              {orphans.map((folder) => (
                <article key={folder.path} className="worktree-row">
                  <span className="worktree-icon" data-variant="warning" aria-hidden="true">
                    <FolderX size={18} />
                  </span>
                  <div className="worktree-identity">
                    <h3>{folder.name}</h3>
                    <p className="worktree-path" title={folder.path}>
                      {displayPath(folder.path, projectPath)}
                    </p>
                    <div className="worktree-meta">
                      <span>
                        {folder.entries === 0
                          ? 'Empty'
                          : `${folder.entries} ${folder.entries === 1 ? 'entry' : 'entries'}`}
                      </span>
                    </div>
                    {folder.blocked_reason && (
                      <p className="task-muted mt-2">{folder.blocked_reason}</p>
                    )}
                  </div>
                  <div className="workspace-actions">
                    {!folder.blocked_reason && (
                      <ConfirmAction
                        title={`Delete ${folder.name}?`}
                        description="This folder in .worktrees/ is not tracked by Git. Deleting it cannot be undone."
                        label="Delete folder"
                        busyLabel="Deleting…"
                        onConfirm={() => removeLeftover([folder])}
                        trigger={
                          <Button
                            variant="outline"
                            disabled={pending || refreshing || !desktop}
                            aria-label={`Delete leftover folder ${folder.name}`}
                          >
                            <Trash2 size={18} aria-hidden="true" />
                            Delete folder
                          </Button>
                        }
                      >
                        {({ busy }) => (
                          <RemovalPlan
                            busy={busy}
                            progress={progress}
                            busyNote={`Deleting ${folder.name}. This may take a moment…`}
                            isFolder
                          />
                        )}
                      </ConfirmAction>
                    )}
                    <IconButton
                      variant="ghost"
                      label={`Copy path for ${folder.name}`}
                      title="Copy path"
                      onClick={() => void copy(folder.path)}
                    >
                      <Copy size={18} />
                    </IconButton>
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </WorkspacePage>
  );
}
