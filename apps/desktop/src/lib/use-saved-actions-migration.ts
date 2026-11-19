import { useEffect } from 'react';
import { type Project, useProjectStore } from '../stores/projectStore';
import { readLegacySavedActions } from '../stores/savedActionsStore';
import type { KnowledgeEntry } from './knowledge-types';
import { isTauriEnvironment } from './native/env';
import { invokeNative } from './native/transport';
import {
  markMigrated,
  planSavedActionsMigration,
  readMigrationMarker,
} from './saved-actions-migration';

const running = new Set<string>();

function localStorageOrUndefined() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Moves saved actions into the opened project: commands into its terminal commands at once,
 * prompts into its reusable workflows through the knowledge store. A failed prompt move is
 * retried the next time the project opens; matching text is never added twice.
 */
async function migrateProject(project: Project) {
  const storage = localStorageOrUndefined();
  const actions = readLegacySavedActions(storage);
  if (!actions.length || running.has(project.id)) return;
  const marker = readMigrationMarker(storage);
  const commandsDone = marker.commands.includes(project.id);
  const promptsDone = marker.prompts.includes(project.id);
  if (commandsDone && promptsDone) return;
  running.add(project.id);
  try {
    const preferences = project.preferences ?? {};
    if (!commandsDone) {
      const { commands } = planSavedActionsMigration(
        actions.filter((action) => action.kind === 'command'),
        project.id,
        {
          workflows: [],
          commands: preferences.terminalCommands ?? [],
          fixedCommands: [
            preferences.prepareCommand,
            preferences.verifyCommand,
            preferences.previewCommand,
          ],
        },
        () => crypto.randomUUID(),
      );
      if (commands.length)
        useProjectStore.getState().updateProjectPreferences(project.id, {
          terminalCommands: [...(preferences.terminalCommands ?? []), ...commands],
        });
      markMigrated(storage, 'commands', project.id);
    }
    if (!promptsDone) {
      const entries = await invokeNative<KnowledgeEntry[]>('knowledge_list', {
        projectId: project.id,
        projectPath: project.path,
      });
      const { workflows } = planSavedActionsMigration(
        actions.filter((action) => action.kind === 'prompt'),
        project.id,
        {
          workflows: entries.filter((entry) => entry.kind === 'workflow'),
          commands: [],
          fixedCommands: [],
        },
        () => crypto.randomUUID(),
      );
      for (const workflow of workflows) {
        const entry: KnowledgeEntry = {
          id: crypto.randomUUID(),
          projectId: project.id,
          projectPath: project.path,
          kind: 'workflow',
          title: workflow.title,
          content: workflow.content,
          keywords: [],
          enabled: true,
          sourceRunId: null,
          revision: 0,
          updatedAt: '',
        };
        await invokeNative('knowledge_save', { entry });
      }
      markMigrated(storage, 'prompts', project.id);
    }
  } catch (cause) {
    console.warn(`Saved prompts for ${project.name} will move to workflows next time:`, cause);
  } finally {
    running.delete(project.id);
  }
}

/** Moves the open project's saved actions once; does nothing when there are none. */
export function useSavedActionsMigration() {
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === state.activeProjectId),
  );
  const id = project?.id;
  const path = project?.path;
  useEffect(() => {
    if (!id || !path || !isTauriEnvironment()) return;
    const current = useProjectStore.getState().projects.find((item) => item.id === id);
    if (current) void migrateProject(current);
  }, [id, path]);
}
