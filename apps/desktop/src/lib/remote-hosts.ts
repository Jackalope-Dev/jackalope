import { invokeNative } from './native/transport.ts';

/** A paired computer this app can reach. */
export interface RemoteHost {
  id: string;
  name: string;
  address: string;
  ssh: boolean;
  port: number;
  wsl?: boolean;
}

export const remoteHosts = () => invokeNative<RemoteHost[]>('remote_hosts');

export const pairRemoteHost = (pairing: {
  name: string;
  address: string;
  ssh: boolean;
  wsl: boolean;
  port: number;
  code: string;
}) => invokeNative<RemoteHost>('remote_host_pair', pairing);

export const removeRemoteHost = (id: string) => invokeNative<void>('remote_host_remove', { id });
