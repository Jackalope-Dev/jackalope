import { nativeTask } from './task-runtime';

export interface CommandStatus {
  /** The path a terminal runs for `jackalope`, when one points at this app. */
  command: string | null;
  /** Whether that command's folder is on the login-shell PATH; null when unknown. */
  onPath: boolean | null;
  skipped: string | null;
  error: string | null;
  /** macOS can link the command into /usr/local/bin after an administrator prompt. */
  systemAvailable: boolean;
}

/** Opens a Jackalope terminal window working in `directory`. */
export function openCliTerminal(directory: string) {
  return nativeTask<void>('cli_terminal_window', { directory });
}

export function commandStatus() {
  return nativeTask<CommandStatus>('cli_install_status');
}

export function installSystemCommand() {
  return nativeTask<CommandStatus>('cli_install_system');
}
