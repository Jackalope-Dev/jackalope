import { ArrowLeft, ArrowRight, Bot, Clock, GitBranch, Plus, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { formatTimeAgo } from '../../lib/utils';
import { useMascotStore } from '../../stores/mascotStore';
import { useProjectStore } from '../../stores/projectStore';
import { type TaskStatus, useTaskStore } from '../../stores/taskStore';
import { Button } from '../ui/button';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { TaskModal } from './TaskModal';

const COLUMNS: { id: TaskStatus; title: string; hint: string }[] = [
  { id: 'backlog', title: 'Ideas', hint: 'Start with a possibility' },
  { id: 'refinement', title: 'Ready to shape', hint: 'Make the next step clear' },
  { id: 'in_progress', title: 'In motion', hint: 'Work taking shape' },
  { id: 'verification', title: 'For your review', hint: 'Take a closer look' },
  { id: 'done', title: 'Done', hint: 'Room for what comes next' },
];

export function KanbanBoard() {
  const { tasks, moveTaskStatus } = useTaskStore();
  const projectId = useProjectStore((state) => state.activeProjectId);
  const { say, setMood } = useMascotStore();

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenNew = () => {
    setSelectedTaskId(null);
    setIsModalOpen(true);
    say('Creating a new task ticket. I can help refine the prompt!', 3000);
  };

  const handleOpenExisting = (taskId: string) => {
    setSelectedTaskId(taskId);
    setIsModalOpen(true);
  };

  const handleMove = (e: React.MouseEvent, taskId: string, direction: 'prev' | 'next') => {
    e.stopPropagation();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentIndex = COLUMNS.findIndex((c) => c.id === task.status);
    const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

    if (targetIndex >= 0 && targetIndex < COLUMNS.length) {
      const nextStatus = COLUMNS[targetIndex].id;
      moveTaskStatus(taskId, nextStatus);

      if (nextStatus === 'done') {
        setMood('success');
        say(`“${task.title}” moved to Done.`, 4000);
      } else if (nextStatus === 'in_progress') {
        setMood('working');
        say(`“${task.title}” moved to In motion.`, 3000);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-8 space-y-4">
      {/* Top Header & Actions */}
      <WorkspaceHeading
        title="Planning board"
        description="Organize ideas by stage. Moving a card does not run an agent."
        action={
          <Button onClick={handleOpenNew} size="sm">
            <Plus className="size-3.5" />
            New task
          </Button>
        }
      />

      {/* Kanban Columns */}
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Empty boards need a keyboard scroll target.
        tabIndex={0}
        aria-label="Planning stages"
        className="flex-1 flex gap-3.5 overflow-x-auto pb-4"
      >
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.projectId === projectId && t.status === col.id);

          return (
            <div key={col.id} className="min-w-[208px] flex-1 flex flex-col">
              {/* Column Header */}
              <div className="px-1 py-3 mb-3 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--color-text-primary)]">
                      {col.title}
                    </span>
                    <span className="text-xs font-mono text-[var(--color-text-muted)]">
                      {colTasks.length}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] block truncate">
                    {col.hint}
                  </span>
                </div>
              </div>

              {/* Column Cards */}
              <div className="flex-1 px-1 py-1 overflow-y-auto space-y-3">
                {colTasks.map((task) => (
                  <motion.div
                    key={task.id}
                    layoutId={task.id}
                    className="p-4 rounded-xl bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors duration-150 group relative space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)] leading-snug">
                        <button
                          type="button"
                          onClick={() => handleOpenExisting(task.id)}
                          className="text-left cursor-pointer hover:text-[var(--color-accent-ink)]"
                        >
                          {task.title}
                        </button>
                      </h4>
                      {task.refinedPrompt && (
                        <span
                          title="Refined with Intent Engine"
                          className="text-[var(--color-accent-ink)] shrink-0"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 leading-relaxed">
                      {task.refinedPrompt || task.rawPrompt}
                    </p>

                    {/* Metadata chips */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {task.worktreePath && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent-ink)] font-mono text-xs">
                          <GitBranch className="w-2.5 h-2.5" />
                          <span className="truncate max-w-[90px]">
                            {task.worktreePath.replace('.worktrees/', '')}
                          </span>
                        </span>
                      )}
                      {task.assignedAgent && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] text-xs border border-[var(--color-border-subtle)]">
                          <Bot className="w-2.5 h-2.5 text-[var(--color-accent-ink)]" />
                          <span className="truncate max-w-[80px]">{task.assignedAgent}</span>
                        </span>
                      )}
                    </div>

                    {/* Card Footer with Quick Move Arrows */}
                    <div className="flex items-center justify-between pt-1 border-t border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)]">
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTimeAgo(task.createdAt)}
                      </span>

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        {col.id !== 'backlog' && (
                          <button
                            type="button"
                            onClick={(e) => handleMove(e, task.id, 'prev')}
                            title="Move to previous stage"
                            aria-label={`Move ${task.title} to previous stage`}
                            className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] cursor-pointer"
                          >
                            <ArrowLeft className="w-3 h-3" />
                          </button>
                        )}
                        {col.id !== 'done' && (
                          <button
                            type="button"
                            onClick={(e) => handleMove(e, task.id, 'next')}
                            title="Move to next stage"
                            aria-label={`Move ${task.title} to next stage`}
                            className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-accent-ink)] cursor-pointer"
                          >
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}

                {colTasks.length === 0 && (
                  <div className="h-24 flex items-center justify-center rounded-xl text-xs text-[var(--color-text-muted)]">
                    Nothing here yet
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* Task Modal */}
      {isModalOpen && (
        <TaskModal
          taskId={selectedTaskId}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedTaskId(null);
          }}
        />
      )}
    </div>
  );
}
