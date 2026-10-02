import { nativeTask } from './task-runtime.ts';

export interface SwarmConnection {
  configured: boolean;
  url?: string;
}

export interface SwarmFile {
  path: string;
  base: string | null;
  head: string | null;
}

export interface SwarmFork {
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

export type SwarmConflictKind = 'overlapping-lines' | 'delete-vs-edit' | 'both-added' | 'same-file';

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
export const removeSwarmConnection = () => nativeTask<void>('swarm_connection_remove');
export const cloudState = (projectId: string) =>
  nativeTask<CloudState>('swarm_cloud_state', { projectId });

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
