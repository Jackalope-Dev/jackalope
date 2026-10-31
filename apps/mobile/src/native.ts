import { invoke } from '@tauri-apps/api/core';
import type { RemoteAction } from '../../desktop/src/components/remote/RemoteWorkspace';

/** The paired host's origin, or null when this phone is not paired. */
export const pairedHost = () => invoke<string | null>('companion_host');

/** Pairs with a host from the link it showed; resolves to the host's origin. */
export const pair = (link: string, name: string) =>
  invoke<string>('companion_pair', { link, name });

/** Sends one companion action to the paired host with this phone's token. */
export const request = <T>(action: RemoteAction) => invoke<T>('companion_request', { action });

/** Forgets the pairing on this phone. The host keeps the device until it is removed there. */
export const forget = () => invoke<void>('companion_forget');
