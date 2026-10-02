import { nativeTask } from './task-runtime.ts';

export interface ComposioStatus {
  configured: boolean;
  keyHint: string | null;
  /** The managed connection that delivers connected apps to agents. */
  connectionId: string;
}

export interface ComposioToolkit {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  noAuth: boolean;
  categories: string[];
}

export interface ComposioAccount {
  id: string;
  toolkit: string;
  status: string;
  alias: string | null;
  updatedAt: string | null;
}

export const composioStatus = () => nativeTask<ComposioStatus>('composio_status');
export const saveComposioKey = (apiKey: string) =>
  nativeTask<ComposioStatus>('composio_save_key', { apiKey });
export const removeComposioKey = () => nativeTask<void>('composio_remove_key');
export const composioCatalog = (refresh = false) =>
  nativeTask<ComposioToolkit[]>('composio_catalog', { refresh });
export const composioAccounts = () => nativeTask<ComposioAccount[]>('composio_accounts');
export const authorizeComposioApp = (toolkit: string) =>
  nativeTask<string>('composio_authorize', { toolkit });
export const disconnectComposioAccount = (accountId: string) =>
  nativeTask<void>('composio_disconnect', { accountId });

export type AppState = 'connected' | 'pending' | 'failed' | 'available';

/** Collapses an app's accounts to one state, preferring the most usable. */
export function appState(accounts: ComposioAccount[]): AppState {
  const statuses = accounts.map((account) => account.status.toUpperCase());
  if (statuses.includes('ACTIVE')) return 'connected';
  if (statuses.some((status) => ['INITIATED', 'INITIALIZING', 'PENDING'].includes(status)))
    return 'pending';
  if (statuses.length) return 'failed';
  return 'available';
}

/** Apps people most often connect first, shown before the full catalog loads. */
export const FEATURED_APPS = [
  'github',
  'slack',
  'gmail',
  'googlecalendar',
  'linear',
  'notion',
  'googledrive',
  'jira',
  'sentry',
  'figma',
  'discord',
  'googlesheets',
];
