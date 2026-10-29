import type { ComputerStatus } from './computers.ts';
import { nativeTask } from './task-runtime.ts';

interface AgentBrowserView {
  status: 'live' | 'busy' | 'stopped' | 'unavailable';
  url: string | null;
  /** Base64 PNG of the visible viewport. */
  frame: string | null;
  error: string | null;
}

export type DesktopScope = 'window' | 'app' | 'desktop';

export interface AgentDesktopView {
  status: 'choosing' | 'active' | 'paused' | 'canceled' | 'busy';
  reason: string;
  window: string | null;
  app: string | null;
  /** Absent before a grant and from older builds. */
  scope?: DesktopScope | null;
  /** Window and app grants can be saved as "Always allow" for the project. */
  rememberable?: boolean;
  remembered?: boolean;
  /** Host of the browser page the agent last read. */
  site?: string | null;
}

export interface RememberedDesktopGrant {
  id: string;
  projectId: string;
  scope: DesktopScope | 'unknown';
  app: string;
  label: string;
  createdAt: string;
}

export interface DesktopSiteDecision {
  id: string;
  projectId: string;
  host: string;
  allow: boolean;
  createdAt: string;
}

export interface AgentScreen {
  browser: AgentBrowserView;
  desktop: AgentDesktopView | null;
  /** The run's bot or task computer. Absent from older builds. */
  computer?: ComputerStatus | null;
  capturedAt: string;
}

/** Reads the attempt's browser and desktop access without starting or changing either. */
export const readAgentScreen = (runId: string, capture: boolean) =>
  nativeTask<AgentScreen>('task_agent_screen', { runId, capture });

export const revokeAgentAccess = (runId: string, target: 'browser' | 'desktop') =>
  nativeTask<void>('task_agent_screen_revoke', { runId, target });

/** Saves the attempt's current window or app grant as "Always allow" for its project. */
export const rememberDesktopGrant = (runId: string) =>
  nativeTask<RememberedDesktopGrant>('desktop_control_remember', { runId });

export const desktopPermissions = (projectId: string) =>
  nativeTask<{ grants: RememberedDesktopGrant[]; sites: DesktopSiteDecision[] }>(
    'desktop_control_permissions',
    { projectId },
  );

export const forgetDesktopPermission = (projectId: string, id: string) =>
  nativeTask<void>('desktop_control_forget', { projectId, id });

export function desktopScopeLabel(scope: DesktopScope | null | undefined) {
  switch (scope) {
    case 'app':
      return 'Whole app';
    case 'desktop':
      return 'Full desktop';
    case 'window':
      return 'One window';
    default:
      return null;
  }
}

/** Only web pages can be reopened outside the task's isolated browser. */
export function openableUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function desktopLabel(view: AgentDesktopView | null) {
  if (!view) return { label: 'Not granted', tone: 'default' as const };
  switch (view.status) {
    case 'active':
      return { label: 'In control', tone: 'accent' as const };
    case 'paused':
      return { label: 'Paused', tone: 'warning' as const };
    case 'choosing':
      return { label: 'Waiting for your choice', tone: 'warning' as const };
    case 'busy':
      return { label: 'Working', tone: 'accent' as const };
    default:
      return { label: 'Ended', tone: 'default' as const };
  }
}
