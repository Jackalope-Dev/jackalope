import { Check, Copy, FolderGit2, GitBranch, Lock, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { Input } from '../ui/input';
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
  const branchName = branch ?? `feat/${slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const desktop = isTauriEnvironment();
  useEffect(() => {
    if (activeProjectId) void loadWorktreesForActiveProject();
  }, [loadWorktreesForActiveProject, activeProjectId]);
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
      setCreating(false);
      setSlug('');
      setBranch(null);
      setFeedback('Worktree created.');
    } else setError(result.error);
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
        description="Separate branches and folders for work that can happen together."
        action={
          project && (
            <div className="workspace-actions">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh worktrees"
                title="Refresh worktrees"
                disabled={loading || busy || !desktop}
                onClick={() => void loadWorktreesForActiveProject()}
              >
                <RefreshCw size={18} />
              </Button>
              <Button
                aria-expanded={creating}
                aria-controls="worktree-create"
                disabled={busy || !desktop}
                onClick={() => setCreating(!creating)}
              >
                <Plus size={18} />
                New worktree
              </Button>
            </div>
          )
        }
      />
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
                    disabled={busy}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="search-improvements"
                  />
                </label>
                <label htmlFor="worktree-branch">
                  Branch
                  <Input
                    id="worktree-branch"
                    value={branchName}
                    disabled={busy}
                    onChange={(e) => setBranch(e.target.value)}
                    className="font-mono"
                  />
                </label>
                <Button type="submit" disabled={busy || !slug.trim() || !branchName.trim()}>
                  <GitBranch size={18} />
                  {busy ? 'Creating…' : 'Create worktree'}
                </Button>
              </div>
              <p className="task-muted mt-3">A new branch and folder inside .worktrees.</p>
            </form>
          )}
          {loading && (
            <p role="status" className="task-notice">
              Loading worktrees…
            </p>
          )}
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
                </div>
              </div>
              <Button
                variant="ghost"
                aria-label={`Copy path for ${wt.branch || wt.path}`}
                onClick={() => void copy(wt.path)}
              >
                <Copy size={18} />
                Copy path
              </Button>
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
      {error && (
        <p role="alert" className="task-error">
          {error}
        </p>
      )}
      <p role="status" className="task-notice">
        {feedback && (
          <>
            <Check size={16} aria-hidden="true" />
            <span className="break-all">{feedback}</span>
          </>
        )}
      </p>
    </section>
  );
}
