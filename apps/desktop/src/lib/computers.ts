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
}

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

/** A viewer address for watching (`interactive` false) or taking over, if one is open. */
export const computerViewer = (id: string, interactive: boolean) =>
  nativeTask<string | null>('computer_viewer', { id, interactive });

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
      return 'Stopped';
    case 'not-created':
      return 'Not started yet';
    default:
      return 'Unavailable';
  }
}

/** The app's content policy embeds only viewers served on this device's loopback address. */
export const embeddableViewer = (url: string) => url.startsWith('http://127.0.0.1:');
