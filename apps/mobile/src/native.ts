import { invoke } from '@tauri-apps/api/core';
import type { RemoteAction } from '../../desktop/src/components/remote/useRemoteWorkspace';

/** A host this phone is paired with. Its token stays in the native layer. */
export interface Host {
  id: string;
  origin: string;
  label: string;
}

export const listHosts = () => invoke<Host[]>('companion_hosts');

/** Pairs with a host from the link it showed. Pairing the same host again replaces it. */
export const pair = (link: string, name: string) => invoke<Host>('companion_pair', { link, name });

/** Sends one companion action to a paired host with this phone's token for it. */
export const request = <T>(host: string, action: RemoteAction) =>
  invoke<T>('companion_request', { host, action });

/** Forgets a host on this phone. The host keeps the device until it is removed there. */
export const forget = (host: string) => invoke<void>('companion_forget', { host });
