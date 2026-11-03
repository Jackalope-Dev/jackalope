import { invoke } from '@tauri-apps/api/core';
import type { RemoteAction } from '../../desktop/src/components/remote/useRemoteWorkspace';

/** A host this phone is paired with. Its token stays in the native layer. */
export interface Host {
  id: string;
  origin: string;
  label: string;
}

export const listHosts = () => invoke<Host[]>('companion_hosts');

/**
 * Pairs with a computer from its pairing link, or from its address and the code shown
 * beside it. Pairing the same computer again replaces it.
 */
export const pair = (link: string, name: string, code?: string) =>
  invoke<Host>('companion_pair', { link, name, code: code || null });

/**
 * Opens the camera to scan the QR code Remote access shows and returns its pairing link,
 * or null when the person cancels. Asks for camera access the first time.
 */
export async function scanPairingCode(): Promise<string | null> {
  const scanner = await import('@tauri-apps/plugin-barcode-scanner');
  let permission = await scanner.checkPermissions();
  if (permission !== 'granted') permission = await scanner.requestPermissions();
  if (permission !== 'granted')
    throw new Error('Allow camera access in Settings to scan, or enter the link instead.');
  const result = await scanner.scan({ formats: [scanner.Format.QRCode] });
  return result?.content?.trim() || null;
}

/** Sends one companion action to a paired host with this phone's token for it. */
export const request = <T>(host: string, action: RemoteAction) =>
  invoke<T>('companion_request', { host, action });

/** Forgets a host on this phone. The host keeps the device until it is removed there. */
export const forget = (host: string) => invoke<void>('companion_forget', { host });
