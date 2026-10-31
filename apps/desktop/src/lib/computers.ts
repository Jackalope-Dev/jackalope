import { nativeTask } from './task-runtime.ts';

/** Where a bot computer runs. Unknown values come from newer builds. */
export type ComputerProvider = 'local-docker' | 'remote-machine' | 'jackalope-hosted';

export interface ComputerSettings {
  cpus: number;
  memoryMb: number;
  /** Outbound network. Off also removes the viewer and browser connection. */
  network: boolean;
  /** Host folder shared read-only at /workspace/project (task computers). */
  projectMount?: string | null;
  /** Minutes unused before a local sandbox stops; 0 never stops it. Absent from older builds. */
  idleStopMinutes?: number;
}

export interface ComputerStatus {
  id: string;
  name: string;
  ownerKind: 'bot' | 'task';
  ownerId: string;
  provider: ComputerProvider | string;
  machineId?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  settings: ComputerSettings;
  state: 'not-created' | 'stopped' | 'running' | 'starting' | 'unavailable';
  /** What a starting computer is doing, such as building its image. */
  phase?: string | null;
  error?: string | null;
  /** Whether Watch / take over can open now. */
  viewer: boolean;
  /** An active run or an open viewer holds it, so it is not stopped. */
  inUse?: boolean;
  /** Stopped by the idle stop; it starts again when next used. */
  stoppedIdle?: boolean;
  /** Idle time and when it stops, or why it stopped. */
  usage?: string | null;
}

export interface ComputerPreferences {
  /** Leave local sandboxes running when Jackalope quits. */
  keepRunningOnQuit: boolean;
}

/** Idle stop choices in minutes; 0 is Never. */
export const IDLE_STOP_CHOICES = [
  { minutes: 5, label: '5 minutes' },
  { minutes: 10, label: '10 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 0, label: 'Never' },
];

export interface DockerStatus {
  available: boolean;
  engine: 'docker-desktop' | 'colima' | 'docker' | null;
  clientVersion: string | null;
  serverVersion: string | null;
  arch: string | null;
  message: string | null;
  installUrl: string | null;
}

export interface CloudMachine {
  id: string;
  name: string;
  url: string;
  viewerUrl?: string | null;
  createdAt: string;
}

export interface MachineHealth {
  reachable: boolean;
  screen: [number, number] | null;
  message: string | null;
}

export const DEFAULT_COMPUTER_SETTINGS: ComputerSettings = {
  cpus: 2,
  memoryMb: 4096,
  network: true,
  idleStopMinutes: 10,
};

export const dockerStatus = () => nativeTask<DockerStatus>('computer_docker_status');

export const listComputers = () => nativeTask<ComputerStatus[]>('computer_list');

export const botComputer = (botId: string) =>
  nativeTask<ComputerStatus | null>('computer_status', { ownerKind: 'bot', ownerId: botId });

export const configureBotComputer = (
  bot: { id: string; name: string },
  provider: ComputerProvider,
  machineId: string | null,
  settings: ComputerSettings,
) =>
  nativeTask<ComputerStatus>('computer_configure', {
    ownerKind: 'bot',
    ownerId: bot.id,
    ownerName: bot.name,
    provider,
    machineId,
    settings,
  });

/** Starts in the background; poll the status for its phase. */
export const startComputer = (id: string) => nativeTask<ComputerStatus>('computer_start', { id });

export const stopComputer = (id: string) => nativeTask<ComputerStatus>('computer_stop', { id });

export const deleteComputer = (id: string) => nativeTask<void>('computer_delete', { id });

/**
 * A viewer address for watching (`interactive` false) or taking over, starting
 * a stopped computer first. `lease` keeps the computer running while the viewer
 * is open; renew it with {@link holdComputerViewer}.
 */
export const computerViewer = (id: string, interactive: boolean, lease: string) =>
  nativeTask<string | null>('computer_viewer', { id, interactive, lease });

/** Renews (`open`) or releases an open viewer's hold on a computer. */
export const holdComputerViewer = (id: string, lease: string, open: boolean) =>
  nativeTask<void>('computer_viewer_lease', { id, lease, open });

export const setComputerIdleStop = (id: string, minutes: number) =>
  nativeTask<ComputerStatus>('computer_idle_timeout', { id, minutes });

export const computerPreferences = () => nativeTask<ComputerPreferences>('computer_preferences');

export const setComputerPreferences = (preferences: ComputerPreferences) =>
  nativeTask<ComputerPreferences>('computer_set_preferences', { preferences });

export const cloudMachines = () =>
  nativeTask<{ machines: CloudMachine[]; hostedAvailable: boolean }>('computer_machines');

export const addCloudMachine = (
  name: string,
  url: string,
  secret: string,
  viewerUrl: string | null,
) => nativeTask<CloudMachine>('computer_machine_add', { name, url, secret, viewerUrl });

export const testCloudMachine = (id: string) =>
  nativeTask<MachineHealth>('computer_machine_test', { id });

export const removeCloudMachine = (id: string) =>
  nativeTask<void>('computer_machine_remove', { id });

export const providerLabel = (provider: string) =>
  provider === 'local-docker'
    ? 'Local sandbox'
    : provider === 'remote-machine'
      ? 'Cloud machine'
      : provider === 'jackalope-hosted'
        ? 'Jackalope-hosted'
        : 'Unknown machine';

export function computerStateLabel(status: ComputerStatus): string {
  switch (status.state) {
    case 'running':
      return 'Running';
    case 'starting':
      return 'Starting';
    case 'stopped':
      return status.stoppedIdle ? 'Stopped (idle)' : 'Stopped';
    case 'not-created':
      return 'Not started yet';
    default:
      return 'Unavailable';
  }
}

/** Idle time and when it stops, such as "Idle 3 min · stops in 7 min", if known. */
export function computerUsage(status: ComputerStatus): string | null {
  const usage = status.usage?.trim();
  return usage ? usage.charAt(0).toUpperCase() + usage.slice(1) : null;
}

/** The app's content policy embeds only viewers served on this device's loopback address. */
export const embeddableViewer = (url: string) => url.startsWith('http://127.0.0.1:');
