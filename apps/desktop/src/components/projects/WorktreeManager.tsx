import {
  Archive,
  Check,
  Copy,
  FolderGit2,
  GitBranch,
  GitMerge,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  archiveWorktree,
  cleanupWorktree,
  isTauriEnvironment,
  pruneWorktrees,
  type WorktreeEntry,
} from '../../lib/tauri-bridge';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { ConfirmAction } from '../ui/ConfirmAction';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/input';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';

export function WorktreeManager({ onOpenProject }: { onOpenProject: () => void }) {
  const {
    projects,
    activeProjectId,
    loadWorktreesForActiveProject,
    spawnTaskWorktree,
    loading,
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
  const pending = busy || removing !== null;
  const ready = (project?.worktrees ?? []).filter(
    (wt) => wt.cleanup?.merged && !wt.cleanup.blocked_reason,
  );
  const missing = (project?.worktrees ?? []).filter((wt) => wt.cleanup?.missing && !wt.is_locked);
  const targetBranch = target === 'auto' ? undefined : target;
  const projectId = useRef(activeProjectId);
  const refreshButton = useRef<HTMLButtonElement>(null);
  projectId.current = activeProjectId;
  useEffect(() => {
    if (!loading && !pending && feedback.startsWith('Removed ')) refreshButton.current?.focus();
  }, [feedback, loading, pending]);
  const branchName = branch ?? `feat/${slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const desktop = isTauriEnvironment();
  useEffect(() => {
    setError('');
    setFeedback('');
    if (activeProjectId) void loadWorktreesForActiveProject(targetBranch);
  }, [loadWorktreesForActiveProject, activeProjectId, targetBranch]);
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
      await loadWorktreesForActiveProject(targetBranch);
      setCreating(false);
      setSlug('');
      setBranch(null);
      setFeedback('Worktree created.');
    } else setError(result.error);
  };
  const cleanup = async (worktree: WorktreeEntry) => {
    if (pending || !project) return;
    const id = project.id;
    setRemoving(worktree.path);
    setError('');
    setFeedback('');
    try {
      await cleanupWorktree(project.path, worktree);
      if (projectId.current === id) {
        setFeedback(`Removed ${worktree.branch || worktree.path}. Branch and task history kept.`);
      }
    } catch (cause) {
      if (projectId.current === id)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (projectId.current === id) await loadWorktreesForActiveProject(targetBranch);
      setRemoving(null);
    }
  };
  const archive = async (worktree: WorktreeEntry) => {
    if (!project) return;
    const id = project.id;
    setRemoving(worktree.path);
    setError('');
    setFeedback('');
    try {
      const location = await archiveWorktree(project.path, worktree);
      if (projectId.current === id)
        setFeedback(`Archived to ${location}, then removed the worktree.`);
    } finally {
      // The confirm dialog surfaces any error; just refresh the list either way.
      if (projectId.current === id) await loadWorktreesForActiveProject(targetBranch);
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
      for (const worktree of candidates) {
        await cleanupWorktree(project.path, worktree);
        removed++;
      }
    } catch (cause) {
      if (projectId.current === id)
        setError(`Cleanup stopped. ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      if (projectId.current === id) {
        setFeedback(
          `Removed ${removed} of ${candidates.length} worktrees. Branches and task history kept.`,
        );
        await loadWorktreesForActiveProject(targetBranch);
      }
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
            ? `Removed ${dropped} missing worktree ${dropped === 1 ? 'entry' : 'entries'}. No folders or branches were deleted.`
            : 'No missing worktree entries to remove.',
        );
    } catch (cause) {
      if (projectId.current === id)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (projectId.current === id) await loadWorktreesForActiveProject(targetBranch);
      setBusy(false);
    }
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
  return (
    <section className="task-page">
      <WorkspaceHeading
        title="Worktrees"
        action={
          project && (
            <div className="workspace-actions">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh worktrees"
                ref={refreshButton}
                title="Refresh worktrees"
                disabled={loading || pending || !desktop}
                onClick={() => void loadWorktreesForActiveProject(targetBranch)}
              >
                <RefreshCw size={18} />
              </Button>
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
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      <div role="status">
        {feedback && (
          <p className="task-notice">
            <Check size={16} aria-hidden="true" />
            <span className="break-all">{feedback}</span>
          </p>
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
          <div className="worktree-cleanup-toolbar">
            <label htmlFor="worktree-target">Check merged into</label>
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
            <ConfirmAction
              title={`Clean up ${ready.length} merged worktrees?`}
              description={`Removes only clean folders whose commits are merged into the selected local branch. Branches and task history are kept. Each folder is checked again before removal. ${ready.map((wt) => wt.branch || wt.path).join(', ')}`}
              label="Clean up merged"
              busyLabel="Cleaning up…"
              onConfirm={cleanupMerged}
              trigger={
                <Button disabled={pending || loading || !desktop || !ready.length}>
                  <Trash2 size={18} aria-hidden="true" />
                  Clean up merged ({ready.length})
                </Button>
              }
            />
            {missing.length > 0 && (
              <Button
                variant="outline"
                disabled={pending || loading || !desktop}
                onClick={() => void prune()}
              >
                Remove missing entries ({missing.length})
              </Button>
            )}
            <p className="task-muted">
              {ready.length} ready to remove · {missing.length} missing. Worktrees with local
              changes need review, even when their commits are merged.
            </p>
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
                <Button type="submit" disabled={pending || !slug.trim() || !branchName.trim()}>
                  <GitBranch size={18} />
                  {busy ? 'Creating…' : 'Create worktree'}
                </Button>
              </div>
            </form>
          )}
          {loading && <LoadingState label={'Loading worktrees…'} />}
          {project.worktrees?.map((wt) => (
            <article key={wt.path} className="worktree-row">
              <GitBranch
                size={24}
                aria-hidden="true"
                className="text-[var(--color-accent-ink)] shrink-0"
              />
              <div className="worktree-identity">
                <h2>{wt.branch || (wt.is_bare ? 'Bare repository' : 'Detached HEAD')}</h2>
                <p className="task-muted mt-1">{wt.path}</p>
                <div className="worktree-meta">
                  <span className="font-mono">
                    {wt.head ? wt.head.slice(0, 7) : 'No resolved commit'}
                  </span>
                  {wt.is_locked && (
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
                      : wt.cleanup?.merged === true
                        ? `Merged into ${wt.cleanup.target_branch}`
                        : wt.cleanup?.merged === false
                          ? `Not merged into ${wt.cleanup.target_branch}`
                          : 'Merge status unavailable'}
                  </span>
                </div>
                {wt.cleanup?.blocked_reason && (
                  <p className="task-muted mt-2">{wt.cleanup.blocked_reason}</p>
                )}
              </div>
              <div className="workspace-actions">
                {wt.cleanup?.merged && !wt.cleanup.blocked_reason && (
                  <Button
                    variant="outline"
                    disabled={loading || pending || !desktop}
                    aria-label={`Remove worktree ${wt.branch || wt.path}`}
                    onClick={() => void cleanup(wt)}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                    {removing === wt.path ? 'Removing…' : 'Remove worktree'}
                  </Button>
                )}
                {wt.cleanup?.recoverable && (
                  <ConfirmAction
                    title="Archive and remove this worktree?"
                    description="Its commits, uncommitted changes and untracked files are saved to .worktrees/.archive first (ignored files such as build output and dependencies are not). The folder is then force-removed and any jackalope/ branch deleted. Restore later with git from the saved bundle."
                    label="Archive & remove"
                    busyLabel="Archiving…"
                    onConfirm={() => archive(wt)}
                    trigger={
                      <Button
                        variant="outline"
                        disabled={loading || pending || !desktop}
                        aria-label={`Archive and remove ${wt.branch || wt.path}`}
                      >
                        <Archive size={18} aria-hidden="true" />
                        {removing === wt.path ? 'Archiving…' : 'Archive & remove'}
                      </Button>
                    }
                  />
                )}
                <Button
                  variant="ghost"
                  aria-label={`Copy path for ${wt.branch || wt.path}`}
                  onClick={() => void copy(wt.path)}
                >
                  <Copy size={18} />
                  Copy path
                </Button>
              </div>
            </article>
          ))}
          {worktreesError && (
            <p role="alert" className="task-error">
              {worktreesError}
            </p>
          )}
          {!loading && !worktreesError && !project.worktrees?.length && (
            <EmptyState
              icon={GitBranch}
              title="A place for parallel work"
              description="Create a worktree here, or let a new task create one automatically."
            />
          )}
        </>
      )}
    </section>
  );
}
