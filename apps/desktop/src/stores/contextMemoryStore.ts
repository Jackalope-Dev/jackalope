import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { discoverCodebaseContext } from '../lib/orchestration/codebase-discovery';
import type { DiscoveredCodebaseMemory } from '../lib/orchestration/types';
import { useAuditStore } from './auditStore';
import { useMascotStore } from './mascotStore';

interface ContextMemoryState {
  memories: Record<string, DiscoveredCodebaseMemory>;
  scanning: Record<string, boolean>;
  getMemory: (projectId: string) => DiscoveredCodebaseMemory | undefined;
  refreshMemory: (
    project: { id: string; name: string; path: string },
    options?: { silent?: boolean },
  ) => Promise<DiscoveredCodebaseMemory>;
  updateConventions: (projectId: string, conventions: string[]) => void;
  removeMemory: (projectId: string) => void;
}

export const useContextMemoryStore = create<ContextMemoryState>()(
  persist(
    (set, get) => ({
      memories: {},
      scanning: {},

      getMemory: (projectId) => get().memories[projectId],

      refreshMemory: async (project, options = {}) => {
        const { id, name, path } = project;
        set((state) => ({ scanning: { ...state.scanning, [id]: true } }));
        if (!options.silent) {
          useMascotStore.getState().setMood('thinking');
        }

        try {
          const memory = await discoverCodebaseContext({
            projectId: id,
            projectName: name,
            projectPath: path,
          });

          set((state) => ({
            memories: { ...state.memories, [id]: memory },
            scanning: { ...state.scanning, [id]: false },
          }));

          if (!options.silent) {
            useMascotStore.getState().setMood('success');
            setTimeout(() => {
              useMascotStore.getState().setMood('idle');
            }, 2500);
          }

          // Record in Audit Log
          useAuditStore.getState().addEntry({
            projectId: id,
            projectName: name,
            category: 'discovery',
            severity: 'info',
            title: `Codebase Context Discovered`,
            message: `Scanned ${memory.sourceFilesDetected.join(', ')} (${memory.techStack.join(', ')}). Extracted ${memory.openTasks.filter((t) => t.status === 'open').length} open tasks and ${memory.conventions.length} invariants.`,
            details: {
              techStack: memory.techStack,
              openTaskCount: memory.openTasks.length,
              conventionsCount: memory.conventions.length,
              durationMs: memory.scanDurationMs,
            },
          });

          return memory;
        } catch (error) {
          set((state) => ({ scanning: { ...state.scanning, [id]: false } }));
          useAuditStore.getState().addEntry({
            projectId: id,
            projectName: name,
            category: 'discovery',
            severity: 'warning',
            title: 'Codebase Discovery Incomplete',
            message: `Could not read repository context: ${String(error)}`,
          });
          throw error;
        }
      },

      updateConventions: (projectId, conventions) => {
        set((state) => {
          const existing = state.memories[projectId];
          if (!existing) return state;
          return {
            memories: {
              ...state.memories,
              [projectId]: { ...existing, conventions },
            },
          };
        });
      },

      removeMemory: (projectId) => {
        set((state) => {
          const next = { ...state.memories };
          delete next[projectId];
          return { memories: next };
        });
      },
    }),
    {
      name: 'jackalope-context-memory',
    },
  ),
);
