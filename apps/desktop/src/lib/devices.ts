import { invokeNative } from './native/transport.ts';

/** A physical iPhone or iPad paired with this Mac, as devicectl lists it. */
export interface Device {
  id: string;
  udid: string | null;
  name: string;
  model: string | null;
  kind: string | null;
  osVersion: string | null;
  connection: 'usb' | 'network' | 'available' | 'unavailable';
  paired: boolean;
  developerMode: 'enabled' | 'disabled' | 'unknown';
  ddiServices: boolean;
  /** Why apps cannot be installed or launched right now; null when they can. */
  problem: string | null;
}

export type DeviceLevel = 'see' | 'control';

interface AttachedDevice {
  deviceId: string;
  name: string;
  level: DeviceLevel | 'unknown';
}

/** A device allowed for every conversation in a project. */
export interface RememberedDevice {
  id: string;
  projectId: string;
  deviceId: string;
  name: string;
  level: DeviceLevel | 'unknown';
  createdAt: string;
}

export interface DeviceAccess {
  attached: AttachedDevice | null;
  remembered: RememberedDevice[];
}

export interface DeviceSupport {
  supported: boolean;
  reason: string | null;
  /** The workspace has an Xcode project or workspace to build. */
  xcodeProject: boolean;
}

export type DeviceRunPhase =
  | 'building'
  | 'installing'
  | 'launching'
  | 'running'
  | 'failed'
  | 'canceled';

export interface DeviceRunState {
  device: string;
  phase: DeviceRunPhase;
  error: string | null;
  output: string[];
  console: string[];
  consoleRunning: boolean;
  consoleEnded: string | null;
}

/** Emitted with a conversation id when its device, run or console changed. */
export const DEVICE_CHANGED_EVENT = 'device-changed';

export const deviceSupport = (workspace?: string) =>
  invokeNative<DeviceSupport>('device_support', { workspace: workspace ?? null });

export const listDevices = () => invokeNative<Device[]>('device_list');

export const attachDevice = (args: {
  conversation: string;
  projectId: string;
  deviceId: string;
  control: boolean;
  remember: boolean;
}) => invokeNative<DeviceAccess>('device_attach', args);

export const deviceAccess = (conversation: string, projectId: string) =>
  invokeNative<DeviceAccess>('device_attached', { conversation, projectId });

export const detachDevice = (conversation: string, projectId: string) =>
  invokeNative<DeviceAccess>('device_detach', { conversation, projectId });

export const devicePermissions = (projectId: string) =>
  invokeNative<RememberedDevice[]>('device_permissions', { projectId });

export const forgetDevice = (projectId: string, id: string) =>
  invokeNative<void>('device_forget', { projectId, id });

export const runOnDevice = (conversation: string, runId: string, deviceId: string) =>
  invokeNative<void>('device_run', { conversation, runId, deviceId });

export const deviceRunState = (conversation: string) =>
  invokeNative<DeviceRunState | null>('device_run_state', { conversation });

export const cancelDeviceRun = (conversation: string) =>
  invokeNative<void>('device_run_cancel', { conversation });

/** A device's model, iOS version and connection, for a list row. */
export function deviceSummary(device: Device) {
  const connection = {
    usb: 'USB',
    network: 'Network',
    available: 'Available',
    unavailable: 'Not connected',
  }[device.connection];
  return [
    device.model ?? device.kind,
    device.osVersion && `${device.kind === 'iPad' ? 'iPadOS' : 'iOS'} ${device.osVersion}`,
    connection,
  ]
    .filter(Boolean)
    .join(' · ');
}

export const DEVICE_RUN_ACTIVE: DeviceRunPhase[] = ['building', 'installing', 'launching'];

export function deviceRunLabel(phase: DeviceRunPhase) {
  return {
    building: 'Building…',
    installing: 'Installing…',
    launching: 'Launching…',
    running: 'Running',
    failed: 'Failed',
    canceled: 'Canceled',
  }[phase];
}
