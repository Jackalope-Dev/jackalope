import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock,
  ListTodo,
  RefreshCw,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useContextMemoryStore } from '../../stores/contextMemoryStore';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';

interface CodebaseMemoryBarProps {
  project: Project;
}

export function CodebaseMemoryBar({ project }: CodebaseMemoryBarProps) {
  const { memories, scanning, refreshMemory } = useContextMemoryStore();
  const memory = memories[project.id];
  const isScanning = scanning[project.id] ?? false;

  const [expanded, setExpanded] = useState(false);

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isScanning) return;
    try {
      await refreshMemory({
        id: project.id,
        name: project.name,
        path: project.path,
      });
    } catch (e) {
      console.warn('Refresh failed', e);
    }
  };

  const openTasks = memory?.openTasks.filter((t) => t.status === 'open') ?? [];
  const relativeTime = memory?.lastScannedAt
    ? new Date(memory.lastScannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Not yet scanned';

  return (
    <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] overflow-hidden transition-all">
      {/* Summary Bar */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="p-3 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="p-1 rounded-md bg-[var(--color-accent-subtle)] text-[var(--color-accent)] flex items-center gap-1 font-medium">
            <Sparkles size={13} />
            Repo Context
          </span>

          {/* Tech Stack Chips */}
          {memory?.techStack && memory.techStack.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {memory.techStack.slice(0, 4).map((tech) => (
                <span
                  key={tech}
                  className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border-subtle)]"
                >
                  {tech}
                </span>
              ))}
              {memory.techStack.length > 4 && (
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  +{memory.techStack.length - 4}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-[var(--color-text-muted)] italic">
              Click refresh to discover codebase metadata
            </span>
          )}

          {/* Open Tasks Count */}
          {openTasks.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
              <ListTodo size={11} />
              {openTasks.length} open {openTasks.length === 1 ? 'task' : 'tasks'}
            </span>
          )}

          {/* Invariants / Conventions Count */}
          {memory?.conventions && memory.conventions.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              <Shield size={11} />
              {memory.conventions.length} invariants
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1">
            <Clock size={11} />
            {relativeTime}
          </span>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isScanning}
            className="h-7 px-2.5 text-xs gap-1.5"
          >
            <RefreshCw size={12} className={isScanning ? 'animate-spin text-[var(--color-accent)]' : ''} />
            {isScanning ? 'Scanning…' : 'Refresh Context'}
          </Button>

          <button
            type="button"
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            aria-label={expanded ? 'Collapse context memory' : 'Expand context memory'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded Context Details Drawer */}
      {expanded && (
        <div className="p-4 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] space-y-4 text-xs">
          {/* Summary & Manifests */}
          <div>
            <span className="font-semibold text-[var(--color-text)] block mb-1">
              Discovered Architecture & Manifests
            </span>
            <p className="text-[var(--color-text-muted)] leading-relaxed">
              {memory?.summary ?? 'No summary available.'}
            </p>
            {memory?.sourceFilesDetected && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {memory.sourceFilesDetected.map((file) => (
                  <span
                    key={file}
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
                  >
                    {file}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Open Tasks List */}
          {openTasks.length > 0 && (
            <div>
              <span className="font-semibold text-[var(--color-text)] flex items-center gap-1.5 mb-2">
                <ListTodo size={13} className="text-amber-500" />
                Detected Open Tasks (from TODO.md / STATUS.md)
              </span>
              <ul className="space-y-1.5 pl-1 max-h-40 overflow-y-auto pr-2">
                {openTasks.slice(0, 8).map((task) => (
                  <li
                    key={task.id}
                    className="flex items-start gap-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                  >
                    <CircleDot size={12} className="text-amber-500/70 shrink-0 mt-0.5" />
                    <span>{task.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Conventions & Invariants */}
          {memory?.conventions && memory.conventions.length > 0 && (
            <div>
              <span className="font-semibold text-[var(--color-text)] flex items-center gap-1.5 mb-2">
                <Shield size={13} className="text-emerald-500" />
                Project Invariants & Conventions (Injected into tasks)
              </span>
              <ul className="space-y-1 pl-1 max-h-36 overflow-y-auto pr-2">
                {memory.conventions.slice(0, 6).map((conv, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-[var(--color-text-muted)]">
                    <CheckCircle2 size={12} className="text-emerald-500 shrink-0 mt-0.5" />
                    <span>{conv}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
