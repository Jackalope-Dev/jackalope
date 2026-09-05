import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTaskStore } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useMascotStore } from '../../stores/mascotStore';
import { PromptRefiner } from '../prompt/PromptRefiner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import {
  X,
  GitBranch,
  Bot,
  Sparkles,
  CheckCircle2,
  Trash2,
  Play,
} from 'lucide-react';

interface TaskModalProps {
  taskId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function TaskModal({ taskId, isOpen, onClose }: TaskModalProps) {
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const { tasks, addTask, updateTask, deleteTask } = useTaskStore();
  const { spawnTaskWorktree, activeProjectId } = useProjectStore();
  const { say, setMood } = useMascotStore();

  const existingTask = tasks.find((t) => t.id === taskId);
  const isNew = !existingTask;

  const [title, setTitle] = useState(existingTask?.title || '');
  const [rawPrompt, setRawPrompt] = useState(existingTask?.rawPrompt || '');
  const [refinedPrompt, setRefinedPrompt] = useState(existingTask?.refinedPrompt || '');
  const [assignedAgent, setAssignedAgent] = useState(existingTask?.assignedAgent || 'Agent Claude-3.7-Sonnet');
  const [showRefiner, setShowRefiner] = useState(false);
  const [isSpawningWorktree, setIsSpawningWorktree] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!title.trim()) return;

    if (isNew) {
      addTask({
        projectId: activeProjectId || 'jackalope-core',
        title,
        rawPrompt,
        refinedPrompt: refinedPrompt || undefined,
        status: refinedPrompt ? 'in_progress' : 'refinement',
        assignedAgent,
      });
      say('Task ticket created! Ready to spin out worktree.', 3500);
    } else {
      updateTask(existingTask.id, {
        title,
        rawPrompt,
        refinedPrompt,
        assignedAgent,
      });
      say('Task ticket updated.', 2500);
    }
    onClose();
  };

  const handleSpawnWorktree = async () => {
    if (!existingTask) return;
    setIsSpawningWorktree(true);
    setMood('working');
    say(`Spawning isolated git worktree for ${existingTask.title}...`, 4000);

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
    const branch = `feat/${slug}`;

    const res = await spawnTaskWorktree(slug, branch);
    setIsSpawningWorktree(false);

    if (res) {
      updateTask(existingTask.id, {
        worktreePath: res.path,
        status: 'in_progress',
      });
      setMood('success');
      say(`Worktree created at ${res.path}! Agent can operate safely.`, 4500);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-surface-sunken)]/70 backdrop-blur-sm" />
      <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl rounded-2xl bg-[var(--color-surface)] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <Dialog.Description className="sr-only">Describe the task and choose how you want to work on it.</Dialog.Description>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]/40">
          <div className="flex items-center gap-2">
            <Dialog.Title className="text-sm font-semibold text-[var(--color-text-primary)]">
              {isNew ? 'New task' : 'Task details'}
            </Dialog.Title>
            {existingTask && (
              <Badge variant="accent">{existingTask.status.toUpperCase()}</Badge>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close task"
            className="p-1 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* Title */}
          <div className="space-y-1.5">
            <label htmlFor="task-title" className="text-xs font-semibold text-[var(--color-text-secondary)]">
              Task Title
            </label>
            <Input
              id="task-title"
              placeholder="e.g. Implement browser tool integration with Playwright"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Raw Prompt / Description */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                Raw Intent & Instructions
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRefiner(!showRefiner)}
                className="gap-1.5 text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{showRefiner ? 'Hide Proactive Refiner' : 'Refine with Intent Engine'}</span>
              </Button>
            </div>
            <textarea
              rows={3}
              value={rawPrompt}
              onChange={(e) => setRawPrompt(e.target.value)}
              placeholder="Describe what you want the agent to build, optimize, or fix..."
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] resize-none"
            />
          </div>

          {/* Refiner Component */}
          {showRefiner && (
            <PromptRefiner
              rawPrompt={rawPrompt}
              onApplyRefinement={(refined) => {
                setRefinedPrompt(refined);
                setShowRefiner(false);
              }}
              onCancel={() => setShowRefiner(false)}
            />
          )}

          {/* Refined Meta-Prompt Preview */}
          {refinedPrompt && (
            <div className="p-4 rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent-subtle)]/40 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Synthesized Meta-Prompt (Agent Ready)</span>
                </div>
                <Badge variant="accent">Optimized</Badge>
              </div>
              <pre className="text-[11px] font-mono whitespace-pre-wrap text-[var(--color-text-primary)] leading-relaxed max-h-40 overflow-y-auto">
                {refinedPrompt}
              </pre>
            </div>
          )}

          {/* Assigned Agent & Worktree Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>Assigned Agent Runner</span>
              </label>
              <select
                value={assignedAgent}
                onChange={(e) => setAssignedAgent(e.target.value)}
                className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 text-xs text-[var(--color-text-primary)] focus:outline-none"
              >
                <option>Agent Claude-3.7-Sonnet</option>
                <option>Agent Antigravity (DeepMind)</option>
                <option>Agent Aider (Pairing)</option>
                <option>Local Ollama (Offline)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>Isolated Git Worktree</span>
              </label>
              {existingTask?.worktreePath ? (
                <div className="h-9 flex items-center px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] font-mono text-[11px] text-[var(--color-text-secondary)] truncate">
                  {existingTask.worktreePath}
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSpawnWorktree}
                  disabled={!existingTask || isSpawningWorktree}
                  className="w-full h-9 gap-1.5 justify-center text-xs"
                >
                  <Play className="w-3 h-3 text-[var(--color-accent)]" />
                  <span>{isSpawningWorktree ? 'Spawning...' : 'Spin Out Worktree'}</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]/30">
          {existingTask ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                deleteTask(existingTask.id);
                onClose();
              }}
              className="gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Ticket</span>
            </Button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {isNew ? 'Create Ticket' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
