/** A command offered as a button in a task's terminal; part of a project's preferences. */
export interface TerminalCommand {
  id: string;
  name: string;
  command: string;
  /** Runs in each new task worktree as part of preparation. Undefined means off. */
  runOnWorktreeCreate?: boolean;
  /** Running it marks the terminal to stop when the task is merged or archived. Undefined means off. */
  stopWhenFinished?: boolean;
}

function validTerminalCommand(value: unknown): value is TerminalCommand {
  if (!value || typeof value !== 'object') return false;
  const item = value as TerminalCommand;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    !!item.name.trim() &&
    typeof item.command === 'string' &&
    !!item.command.trim() &&
    item.command.length <= 4000
  );
}

/**
 * Buttons a task terminal offers for a project: its preparation and verification commands,
 * then its extra terminal commands. The preview command is left out: it needs the {port}
 * Start preview fills in.
 */
export function projectTerminalCommands(
  preferences:
    | { prepareCommand?: string; verifyCommand?: string; terminalCommands?: unknown }
    | undefined,
): TerminalCommand[] {
  const fixed: TerminalCommand[] = [
    { id: 'prepare', name: 'Prepare workspace', command: preferences?.prepareCommand ?? '' },
    { id: 'verify', name: 'Verify', command: preferences?.verifyCommand ?? '' },
  ].filter((item) => item.command.trim());
  const extra = Array.isArray(preferences?.terminalCommands)
    ? preferences.terminalCommands.filter(validTerminalCommand)
    : [];
  return [...fixed, ...extra];
}

/** The saved commands that run in each new task worktree, in order, for the native mirror. */
export function worktreeCommandsForRegistry(
  commands: unknown,
): { name: string; command: string }[] | undefined {
  if (!Array.isArray(commands)) return undefined;
  const marked = commands
    .filter(validTerminalCommand)
    .filter((item) => item.runOnWorktreeCreate === true)
    .map((item) => ({ name: item.name.trim(), command: item.command.trim() }));
  return marked.length ? marked : undefined;
}
