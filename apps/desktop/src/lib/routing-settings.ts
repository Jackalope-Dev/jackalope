import type { DecisionMode, JevFallback } from './decisions';
import { nativeTask } from './task-runtime';
export type RoutingMode = DecisionMode;
export interface RoutingSettings {
  mode: RoutingMode;
  defaultMode: RoutingMode;
  projectMode: RoutingMode | null;
  jevFallback: JevFallback;
  connected: boolean;
  checkedAt: string | null;
  revision: number;
  hasKey: boolean;
  storageError: string | null;
}

export const routingSettings = {
  read: (projectId?: string) => nativeTask<RoutingSettings>('routing_settings', { projectId }),
  connect: (key: string, revision: number, projectId?: string) =>
    nativeTask<RoutingSettings>('routing_connect', { key, revision, projectId }),
  setMode: (
    mode: RoutingMode | null,
    revision: number,
    projectId?: string,
    jevFallback?: JevFallback,
  ) => nativeTask<RoutingSettings>('routing_set_mode', { mode, revision, projectId, jevFallback }),
  disconnect: (revision: number, projectId?: string) =>
    nativeTask<RoutingSettings>('routing_disconnect', { revision, projectId }),
};
