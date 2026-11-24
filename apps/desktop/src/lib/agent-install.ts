import { invokeNative } from './native/transport';

export interface AgentInstallPlan {
  /** The npm command Jackalope runs, or null when the agent installs another way. */
  command: string | null;
  /** Whether npm was found on this computer. */
  npm: boolean;
  /** OpenCode's private runner can be prepared instead, without Node.js. */
  managed: boolean;
}

export const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download';

export const agentInstallPlan = (agent: string) =>
  invokeNative<AgentInstallPlan>('agent_install_plan', { agent });

/** Starts the install in a terminal; poll and stop it with the sign-in session commands. */
export const startAgentInstall = (agent: string, cols = 100, rows = 20) =>
  invokeNative<string>('agent_install', { agent, cols, rows });

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const terminalControls = new RegExp(
  [
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}\\[[0-?]*[ -/]*[@-~]`,
    `${ESC}[@-_]`,
  ].join('|'),
  'g',
);

/**
 * Turns terminal output into plain lines: drops escape sequences and keeps the last
 * redraw of a line that a progress spinner rewrote with carriage returns.
 */
export function plainTerminalText(text: string) {
  return text
    .replace(terminalControls, '')
    .split('\n')
    .map((line) => {
      const parts = line.replace(/\r$/, '').split('\r');
      return parts[parts.length - 1] ?? '';
    })
    .join('\n');
}
