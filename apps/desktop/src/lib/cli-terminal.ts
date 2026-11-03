import { nativeTask } from './task-runtime';

/** Opens the user's own terminal running `jackalope` in `directory`. */
export function openCliTerminal(directory: string) {
  return nativeTask<void>('cli_terminal_open', { directory });
}
