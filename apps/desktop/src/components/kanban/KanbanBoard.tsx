import { useState } from 'react';
import { motion } from 'motion/react';
import { useTaskStore, TaskStatus } from '../../stores/taskStore';
import { useProjectStore } from '../../stores/projectStore';
import { useMascotStore } from '../../stores/mascotStore';
import { TaskModal } from './TaskModal';
import { Button } from '../ui/button';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import {
  Plus,
  GitBranch,
  Bot,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Clock,
} from 'lucide-react';
import { formatTimeAgo } from '../../lib/utils';

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
      <WorkspaceHeading title="What will you build next?"
        description="Give an idea a little direction. Follow the work, then make it yours."
        action={<Button onClick={handleOpenNew} size="sm"><Plus className="size-3.5" />New task</Button>} />

      {/* Kanban Columns */}
      <div className="flex-1 flex gap-3.5 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.projectId === projectId && t.status === col.id);

          return (
            <div
              key={col.id}
              className="min-w-[208px] flex-1 flex flex-col"
            >
              {/* Column Header */}
              <div className="px-1 py-3 mb-3 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--color-text-primary)]">
                      {col.title}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                      {colTasks.length}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--color-text-muted)] block truncate">
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
                      <h4 className="text-xs font-semibold text-[var(--color-text-primary)] line-clamp-2 leading-snug">
                        <button type="button" onClick={() => handleOpenExisting(task.id)} className="text-left cursor-pointer hover:text-[var(--color-accent)]">{task.title}</button>
                      </h4>
                      {task.refinedPrompt && (
                        <span title="Refined with Intent Engine" className="text-[var(--color-accent)] shrink-0">
                          <Sparkles className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-[var(--color-text-secondary)] line-clamp-2 leading-relaxed">
                      {task.refinedPrompt || task.rawPrompt}
                    </p>

                    {/* Metadata chips */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {task.worktreePath && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-mono text-[9px]">
                          <GitBranch className="w-2.5 h-2.5" />
                          <span className="truncate max-w-[90px]">{task.worktreePath.replace('.worktrees/', '')}</span>
                        </span>
                      )}
                      {task.assignedAgent && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] text-[9px] border border-[var(--color-border-subtle)]">
                          <Bot className="w-2.5 h-2.5 text-[var(--color-accent)]" />
                          <span className="truncate max-w-[80px]">{task.assignedAgent}</span>
                        </span>
                      )}
                    </div>

                    {/* Card Footer with Quick Move Arrows */}
                    <div className="flex items-center justify-between pt-1 border-t border-[var(--color-border-subtle)] text-[10px] text-[var(--color-text-muted)]">
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTimeAgo(task.createdAt)}
                      </span>

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        {col.id !== 'backlog' && (
                          <button
                            type="button"
                            onClick={(e) => handleMove(e, task.id, 'prev')}
                            title="Move to previous status"
                            className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] cursor-pointer"
                          >
                            <ArrowLeft className="w-3 h-3" />
                          </button>
                        )}
                        {col.id !== 'done' && (
                          <button
                            type="button"
                            onClick={(e) => handleMove(e, task.id, 'next')}
                            title="Advance to next status"
                            className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-accent)] cursor-pointer"
                          >
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}

                {colTasks.length === 0 && (
                  <div className="h-24 flex items-center justify-center rounded-xl text-[11px] text-[var(--color-text-muted)]">
                    Nothing here yet
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task Modal */}
      {isModalOpen && <TaskModal
        taskId={selectedTaskId}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedTaskId(null);
        }}
      />}
    </div>
  );
}
