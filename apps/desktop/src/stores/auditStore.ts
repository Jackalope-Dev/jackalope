import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuditLogEntry } from '../lib/audit';

interface AuditState {
  entries: AuditLogEntry[];
  addEntry: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: string }) => void;
  clearEntries: () => void;
  clearProjectEntries: (projectId: string) => void;
}

export const useAuditStore = create<AuditState>()(
  persist(
    (set) => ({
      entries: [],

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
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { entries?: AuditLogEntry[] };
        return {
          entries: (state.entries ?? []).filter(
            (entry) =>
              !['seed-audit-1', 'seed-audit-2', 'seed-audit-3', 'seed-audit-4'].includes(entry.id),
          ),
        };
      },
    },
  ),
);
