import { nativeTask } from './task-runtime.ts';

export interface SwarmConnection {
  configured: boolean;
  url?: string;
  /** Jackalope deployed this Worker with one-click setup. */
  managed?: boolean;
  /** The app bundles a newer Worker, or the Artifacts namespace changed. */
  updateAvailable?: boolean;
}

export type SwarmSetupStep = 'account' | 'deploy' | 'publish' | 'verify';

export interface SwarmSetupFailure {
  step: SwarmSetupStep;
  message: string;
  recovery: 'reauthorize' | 'token' | 'subdomain' | null;
  link: string | null;
}

type SwarmSetupResult =
  | { ok: true; connection: SwarmConnection }
  | { ok: false; failure: SwarmSetupFailure };

export interface SwarmFile {
  path: string;
  base: string | null;
  head: string | null;
}

interface SwarmFork {
  fork: string;
  attemptId: string;
  agent: string;
  title: string;
  baseCommit: string;
  head: string | null;
  files: SwarmFile[];
  truncated: boolean;
  error: string | null;
  registeredAt: string;
  updatedAt: string;
}

type SwarmConflictKind = 'overlapping-lines' | 'delete-vs-edit' | 'both-added' | 'same-file';

export interface SwarmConflict {
  forks: [string, string];
  path: string;
  kind: SwarmConflictKind;
  lines?: { left: [number, number]; right: [number, number] }[];
}

export interface CloudState {
  configured: boolean;
  repo: string | null;
  swarm: { repo: string; forks: SwarmFork[]; conflicts: SwarmConflict[]; updatedAt: string } | null;
  error: string | null;
  syncedAt: string | null;
}

export const swarmConnection = () => nativeTask<SwarmConnection>('swarm_connection_status');
export const saveSwarmConnection = (url: string, token: string) =>
  nativeTask<SwarmConnection>('swarm_connection_save', { url, token });
export interface SwarmRemoval {
  workerDeleted: boolean;
  /** Set when the Worker is still deployed; says how to delete it by hand. */
  warning: string | null;
}
/** Forgets the Worker; `deleteWorker` also deletes one that one-click setup deployed. */
export const removeSwarmConnection = (deleteWorker = false) =>
  nativeTask<SwarmRemoval>('swarm_connection_remove', { deleteWorker });
/** Deploys or updates the Worker in the connected Cloudflare account and connects it. */
export const setupSwarm = () => nativeTask<SwarmSetupResult>('swarm_setup');
export async function onSwarmSetupProgress(listener: (step: SwarmSetupStep) => void) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<SwarmSetupStep>('swarm-setup-progress', (event) => listener(event.payload));
}
export const cloudState = (projectId: string) =>
  nativeTask<CloudState>('swarm_cloud_state', { projectId });

export const ago = (iso: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return new Date(iso).toLocaleTimeString();
};

export function fileStatus(file: SwarmFile) {
  if (file.base === null) return 'added';
  if (file.head === null) return 'deleted';
  return 'modified';
}

export function conflictSummary(conflict: SwarmConflict) {
  switch (conflict.kind) {
    case 'overlapping-lines': {
      const ranges = (conflict.lines ?? [])
        .map(({ left, right }) => {
          const show = ([a, b]: [number, number]) => (a === b ? `${a}` : `${a}–${b}`);
          return `lines ${show(left)} and ${show(right)}`;
        })
        .join('; ');
      return `Both edit the same lines (${ranges})`;
    }
    case 'delete-vs-edit':
      return 'One deletes the file the other edits';
    case 'both-added':
      return 'Both create this file with different content';
    default:
      return 'Both change this file, and its lines could not be compared';
  }
}
