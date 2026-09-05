import { CheckCircle2, ExternalLink, FolderGit2, GitBranch, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMascotStore } from '../../stores/mascotStore';
import { useProjectStore } from '../../stores/projectStore';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export function WorktreeManager() {
  const { projects, activeProjectId, loadWorktreesForActiveProject, spawnTaskWorktree, loading } =
    useProjectStore();
  const { say, setMood } = useMascotStore();

  const [newWorktreeSlug, setNewWorktreeSlug] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [isSpawning, setIsSpawning] = useState(false);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    loadWorktreesForActiveProject();
  }, [loadWorktreesForActiveProject]);

  const handleCreate = async () => {
    if (!newWorktreeSlug.trim()) return;
    setIsSpawning(true);
    setMood('working');
    say(`Spawning worktree "${newWorktreeSlug}"...`, 3000);

    const branch = newBranch.trim() || `feat/${newWorktreeSlug}`;
    await spawnTaskWorktree(newWorktreeSlug, branch);

    setNewWorktreeSlug('');
    setNewBranch('');
    setIsSpawning(false);
    setMood('success');
    say('Worktree created! Agents can now execute in isolation without branch conflicts.', 4000);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
              Git Worktree Harness
            </h2>
            <Badge variant="accent">Concurrent Agent Isolation</Badge>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Maintain high velocity by isolating each autonomous agent in a distinct filesystem
            worktree.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => loadWorktreesForActiveProject()}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Sync Worktrees</span>
        </Button>
      </div>

      {/* Quick Spawn Card */}
      <div className="p-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-primary)]">
          <Plus className="w-3.5 h-3.5 text-[var(--color-accent)]" />
          <span>Spin Out New Isolated Worktree</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <Input
            placeholder="Worktree slug (e.g. browser-automation)"
            value={newWorktreeSlug}
            onChange={(e) => {
              setNewWorktreeSlug(e.target.value);
              if (!newBranch) {
                setNewBranch(`feat/${e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
              }
            }}
            className="text-xs"
          />
          <Input
            placeholder="Branch name (e.g. feat/browser-automation)"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            className="text-xs font-mono"
          />
          <Button
            onClick={handleCreate}
            disabled={!newWorktreeSlug.trim() || isSpawning}
            className="gap-2 text-xs"
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>{isSpawning ? 'Spawning...' : 'Create Worktree'}</span>
          </Button>
        </div>
      </div>

      {/* Worktrees Table / List */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          Active Worktrees ({activeProject?.worktrees?.length || 0})
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          {activeProject?.worktrees && activeProject.worktrees.length > 0 ? (
            activeProject.worktrees.map((wt) => (
              <div
                key={wt.path}
                className="p-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm hover:border-[var(--color-border-focus)] transition-all"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-[var(--color-text-primary)] font-mono">
                      {wt.path}
                    </span>
                    <Badge variant="accent" className="font-mono text-[10px]">
                      {wt.branch || 'main'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-muted)] font-mono">
                    <span>HEAD: {wt.head?.slice(0, 7) || 'HEAD'}</span>
                    <span>•</span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Ready for Agent Dispatch
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs font-mono"
                    onClick={() => say(`Worktree path copied: ${wt.path}`, 2500)}
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Copy Path</span>
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/50">
              <FolderGit2 className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-2" />
              <p className="text-xs text-[var(--color-text-secondary)] font-medium">
                No active git worktrees found for this repository yet.
              </p>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                Spin one out above or create a task ticket from the Kanban board.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
