import { invokeNative } from './native/transport';

/** Opens the user's own terminal running `jackalope` in `directory`. */
export function openCliTerminal(directory: string) {
  return invokeNative<void>('cli_terminal_open', { directory });
}
