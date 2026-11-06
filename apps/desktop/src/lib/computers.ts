import { nativeTask } from './task-runtime.ts';

/** Where a bot computer runs. Unknown values come from newer builds. */
export type ComputerProvider = 'local-docker' | 'remote-machine' | 'agent37' | 'jackalope-hosted';

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
  ownerKind: 'bot' | 'task' | 'project';
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

/**
 * Who a computer serves: a bot, whose desktop and browser tools act there, or a
 * project, whose task agents run there.
 */
export interface ComputerOwner {
  kind: 'bot' | 'project';
  id: string;
  name: string;
}

export const ownerComputer = (owner: Pick<ComputerOwner, 'kind' | 'id'>) =>
  nativeTask<ComputerStatus | null>('computer_status', {
    ownerKind: owner.kind,
    ownerId: owner.id,
  });

export const configureOwnerComputer = (
  owner: ComputerOwner,
  provider: ComputerProvider,
  machineId: string | null,
  settings: ComputerSettings,
) =>
  nativeTask<ComputerStatus>('computer_configure', {
    ownerKind: owner.kind,
    ownerId: owner.id,
    ownerName: owner.name,
    provider,
    machineId,
    settings,
  });

export const agent37Status = () => nativeTask<{ connected: boolean }>('computer_agent37');

/** Saves the Agent37 API key after Agent37 accepts it, or removes it when `key` is null. */
export const setAgent37Key = (key: string | null) =>
  nativeTask<{ connected: boolean }>('computer_set_agent37_key', { key });

/** This month's Agent37 spend in US dollars, overall and by computer id. */
export const agent37Usage = () =>
  nativeTask<{ total: number; computers: Record<string, number> }>('computer_agent37_usage');

/** A sign-in agents use when they run on a computer. Values never reach the app. */
export interface AgentCredential {
  id: string;
  agent: 'claude' | 'codex' | string;
  label: string;
  saved: boolean;
}

export const agentCredentials = () => nativeTask<AgentCredential[]>('computer_agent_credentials');

/** Saves a sign-in, or removes it when `value` is null. */
export const setAgentCredential = (id: string, value: string | null) =>
  nativeTask<AgentCredential[]>('computer_set_agent_credential', { id, value });

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
  nativeTask<{ machines: CloudMachine[]; hostedAvailable: boolean; image: string }>(
    'computer_machines',
  );

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
      : provider === 'agent37'
        ? 'Agent37'
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

/** Where a project's swarm forks and planned attempts may run. */
export type SwarmHosts = 'device' | 'computers' | 'anywhere';

/** One execution host of a project's capacity pool. */
export interface PoolHost {
  id: string;
  name: string;
  device: boolean;
  /** The project's own computer. */
  pinned: boolean;
  running: number;
  limit: number;
  lastSeen: string | null;
  /** Why contact was lost, until the computer is reached again. */
  lost: string | null;
}

/** A computer the person can add to a project's pool. */
interface PoolChoice {
  id: string;
  name: string;
  provider: string;
  ownerKind: string;
  added: boolean;
}

export interface ProjectHosts {
  swarmHosts: SwarmHosts;
  /** Whether the person chose; otherwise the default applies. */
  chosen: boolean;
  hosts: PoolHost[];
  computers: PoolChoice[];
}

export const projectHosts = (projectId: string) =>
  nativeTask<ProjectHosts>('queue_hosts', { projectId });

export const setProjectHosts = (projectId: string, swarmHosts: SwarmHosts, computers: string[]) =>
  nativeTask<ProjectHosts>('queue_set_hosts', { projectId, swarmHosts, computers });

/** A host's load and health in a few words, such as "2 of 8 running" or "Lost contact". */
export function hostLoad(host: PoolHost): string {
  if (host.lost) return 'Lost contact';
  return `${host.running} of ${host.limit} running`;
}

/** The name an attempt's host goes by: this device, or the computer's name. */
export const runHostName = (run: {
  host?: { name: string } | null;
  remote?: { computerName: string } | null;
}) => run.host?.name ?? run.remote?.computerName ?? null;

/** The app's content policy embeds only viewers served on this device's loopback address. */
export const embeddableViewer = (url: string) => url.startsWith('http://127.0.0.1:');
