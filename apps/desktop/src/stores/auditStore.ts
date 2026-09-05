import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuditLogEntry } from '../lib/orchestration/types';

interface AuditState {
  entries: AuditLogEntry[];
  addEntry: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: string }) => void;
  clearEntries: () => void;
  clearProjectEntries: (projectId: string) => void;
}

const INITIAL_AUDIT_ENTRIES: AuditLogEntry[] = [
  {
    id: 'seed-audit-1',
    timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    projectId: 'global',
    projectName: 'Jackalope Workspace',
    category: 'routing',
    severity: 'info',
    title: 'Intelligent Route Selected: Claude 3.7 Sonnet',
    message: 'Analyzed task intent: complex multi-file refactoring. Candidate score 9.6/10 against Codex o3-mini (8.7/10) and Grok 3 (8.4/10).',
    agent: 'claude',
    model: 'claude-3-7-sonnet',
    details: {
      intent: 'refactoring',
      complexity: 'complex',
      rationale: 'High multi-file coordination score (9.9/10).',
    },
  },
  {
    id: 'seed-audit-2',
    timestamp: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
    projectId: 'global',
    projectName: 'Jackalope Workspace',
    category: 'failover',
    severity: 'warning',
    title: 'Self-Healing Failover Triggered',
    message: 'Codex rate-limit reached (HTTP 429 quota exhausted). Proactively preserved task state and re-routed to Claude 3.7 Sonnet.',
    agent: 'claude',
    model: 'claude-3-7-sonnet',
    details: {
      failedAgent: 'codex',
      failedModel: 'o3-mini',
      reason: 'quota_exceeded',
      reRoutedTo: 'claude',
    },
  },
  {
    id: 'seed-audit-3',
    timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    projectId: 'global',
    projectName: 'Jackalope Workspace',
    category: 'execution',
    severity: 'success',
    title: 'Task Resolved via Failover Runner',
    message: 'Claude 3.7 Sonnet successfully verified and applied all changes in branch (.worktrees/refactor-state).',
    agent: 'claude',
    model: 'claude-3-7-sonnet',
    details: {
      exitCode: 0,
      filesChanged: 4,
    },
  },
  {
    id: 'seed-audit-4',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    projectId: 'global',
    projectName: 'Jackalope Workspace',
    category: 'discovery',
    severity: 'info',
    title: 'Codebase Context Discovered',
    message: 'Scanned package.json, Cargo.toml, TODO.md, AGENTS.md. Extracted 4 open tasks, 6 conventions, and full Tauri v2 + React 19 stack.',
    details: {
      techStack: ['Tauri v2', 'React', 'Tailwind CSS', 'TypeScript', 'Rust'],
      openTasksCount: 4,
      tokenCost: 0,
    },
  },
];

export const useAuditStore = create<AuditState>()(
  persist(
    (set) => ({
      entries: INITIAL_AUDIT_ENTRIES,

      addEntry: (entry) => {
        const fullEntry: AuditLogEntry = {
          ...entry,
          id: crypto.randomUUID(),
          timestamp: entry.timestamp ?? new Date().toISOString(),
        };

        set((state) => {
          // Keep up to 500 recent entries
          const next = [fullEntry, ...state.entries];
          if (next.length > 500) {
            next.length = 500;
          }
          return { entries: next };
        });
      },

      clearEntries: () => set({ entries: [] }),

      clearProjectEntries: (projectId) =>
        set((state) => ({
          entries: state.entries.filter((e) => e.projectId !== projectId),
        })),
    }),
    {
      name: 'jackalope-audit-log-v1',
    },
  ),
);
