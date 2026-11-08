import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { discoverCodebaseContext } from '../lib/context/discovery';
import { missingProjectDefaults } from '../lib/context/project-defaults';
import type { DiscoveredCodebaseMemory } from '../lib/context/types';
import { useAuditStore } from './auditStore';
import { useMascotStore } from './mascotStore';
import { useProjectStore } from './projectStore';
import { describeError } from '@jackalope/contracts/errors';

interface ContextMemoryState {
  memories: Record<string, DiscoveredCodebaseMemory>;
  scanning: Record<string, boolean>;
  getMemory: (projectId: string) => DiscoveredCodebaseMemory | undefined;
  refreshMemory: (
    project: { id: string; name: string; path: string },
    options?: { silent?: boolean; applyDefaults?: boolean },
  ) => Promise<DiscoveredCodebaseMemory>;
  updateConventions: (projectId: string, conventions: string[]) => void;
  removeMemory: (projectId: string) => void;
}

/** Scans someone asked for and is waiting on; silent background refreshes don't count. */
let visibleScans = 0;

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
          visibleScans += 1;
          useMascotStore.getState().setActivity('scan', true);
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

          const current = useProjectStore.getState().projects.find((item) => item.id === id);
          if (options.applyDefaults !== false && current?.path === path) {
            const defaults = missingProjectDefaults(current.preferences, memory.projectDefaults);
            if (Object.keys(defaults).length)
              useProjectStore.getState().updateProjectPreferences(id, defaults);
          }

          if (!options.silent) useMascotStore.getState().say('Repository context updated.', 2500);

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
            message: `Could not read repository context: ${describeError(error)}`,
          });
          throw error;
        } finally {
          if (!options.silent) {
            visibleScans -= 1;
            useMascotStore.getState().setActivity('scan', visibleScans > 0);
          }
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
