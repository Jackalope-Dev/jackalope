import { invokeNative } from './native/transport.ts';

export interface SystemInfo {
  os: string;
  arch: string;
  device_name: string;
  git_available: boolean;
  desktop_control?: DesktopControlReadiness;
}

export interface DesktopControlReadiness {
  available: boolean;
  message: string;
  can_request_permissions: boolean;
  missing?: DesktopPermission[];
}

export type DesktopPermission = 'accessibility' | 'screenRecording' | 'inputMonitoring';

export const getSystemInfo = () => invokeNative<SystemInfo>('system_get_info');

export const openDesktopPermissionSettings = (permission: DesktopPermission) =>
  invokeNative<void>('desktop_control_open_settings', { permission });

export const restartForDesktopPermissions = () => invokeNative<void>('desktop_control_restart');

export const requestDesktopControlPermissions = () =>
  invokeNative<DesktopControlReadiness>('desktop_control_request_permissions');
