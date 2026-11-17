import type { SavedAction } from '../stores/savedActionsStore.ts';
import type { TerminalCommand } from './terminal-commands.ts';

/** A saved prompt as it becomes one of the project's reusable workflows. */
interface WorkflowSeed {
  title: string;
  content: string;
}

/**
 * Projects whose saved prompts and commands have moved. Each project migrates once, when it
 * is first opened, so prompts saved for all projects also reach projects opened later.
 */
const SAVED_ACTIONS_MIGRATED_KEY = 'jackalope-saved-actions-migrated-v1';
interface MigrationMarker {
  prompts: string[];
  commands: string[];
}

// Workflow limits enforced by knowledge_save.
const TITLE_BYTES = 120;
const CONTENT_BYTES = 6000;

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

/** Shortens text to a byte limit at a character boundary, ending in an ellipsis. */
function clip(text: string, limit: number) {
  if (bytes(text) <= limit) return text;
  let out = '';
  for (const char of text) {
    if (bytes(out + char) > limit - bytes('…')) break;
    out += char;
  }
  return `${out.trimEnd()}…`;
}

const same = (a: string, b: string) => a.trim() === b.trim();

/**
 * What one project gains from the saved actions: its own and the all-project ones. Prompts
 * become workflows unless the project already has one with the same text; commands become
 * terminal commands unless the project already offers the same command.
 */
export function planSavedActionsMigration(
  actions: SavedAction[],
  projectId: string,
  existing: {
    workflows: { content: string }[];
    commands: TerminalCommand[];
    /** The project's preparation, verification and preview commands. */
    fixedCommands: (string | undefined)[];
  },
  makeId: () => string,
): { workflows: WorkflowSeed[]; commands: TerminalCommand[] } {
  const workflows: WorkflowSeed[] = [];
  const commands: TerminalCommand[] = [];
  const known = [
    ...existing.commands.map((item) => item.command),
    ...existing.fixedCommands.filter((item): item is string => !!item?.trim()),
  ];
  for (const action of actions) {
    if (action.projectId !== null && action.projectId !== projectId) continue;
    if (action.kind === 'prompt') {
      const content = clip(action.body.trim(), CONTENT_BYTES);
      if ([...existing.workflows, ...workflows].some((item) => same(item.content, content)))
        continue;
      workflows.push({
        title: clip(action.name.replace(/\s+/g, ' ').trim(), TITLE_BYTES),
        content,
      });
    } else {
      const command = action.body.trim();
      if ([...known, ...commands.map((item) => item.command)].some((item) => same(item, command)))
        continue;
      commands.push({ id: makeId(), name: action.name.trim(), command });
    }
  }
  return { workflows, commands };
}

export function readMigrationMarker(
  storage: Pick<Storage, 'getItem'> | undefined,
): MigrationMarker {
  try {
    const value = JSON.parse(storage?.getItem(SAVED_ACTIONS_MIGRATED_KEY) ?? '{}') as Partial<
      Record<keyof MigrationMarker, unknown>
    >;
    const ids = (list: unknown) =>
      Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
    return { prompts: ids(value.prompts), commands: ids(value.commands) };
  } catch {
    return { prompts: [], commands: [] };
  }
}

/** Records that a project's prompts or commands have moved. */
export function markMigrated(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  part: keyof MigrationMarker,
  projectId: string,
) {
  const marker = readMigrationMarker(storage);
  if (marker[part].includes(projectId)) return;
  marker[part] = [...marker[part], projectId];
  storage?.setItem(SAVED_ACTIONS_MIGRATED_KEY, JSON.stringify(marker));
}
