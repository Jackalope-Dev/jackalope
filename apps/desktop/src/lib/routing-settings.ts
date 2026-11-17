import type { DecisionMode, JevFallback } from './decisions';
import { invokeNative } from './native/transport';
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
  read: (projectId?: string) => invokeNative<RoutingSettings>('routing_settings', { projectId }),
  connect: (key: string, revision: number, projectId?: string) =>
    invokeNative<RoutingSettings>('routing_connect', { key, revision, projectId }),
  setMode: (
    mode: RoutingMode | null,
    revision: number,
    projectId?: string,
    jevFallback?: JevFallback,
  ) =>
    invokeNative<RoutingSettings>('routing_set_mode', { mode, revision, projectId, jevFallback }),
  disconnect: (revision: number, projectId?: string) =>
    invokeNative<RoutingSettings>('routing_disconnect', { revision, projectId }),
};
