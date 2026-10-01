import { nativeTask } from './task-runtime.ts';

export interface AgentBrowserView {
  status: 'live' | 'busy' | 'stopped' | 'unavailable';
  url: string | null;
  /** Base64 PNG of the visible viewport. */
  frame: string | null;
  error: string | null;
}

export interface AgentDesktopView {
  status: 'choosing' | 'active' | 'paused' | 'canceled' | 'busy';
  reason: string;
  window: string | null;
  app: string | null;
}

export interface AgentScreen {
  browser: AgentBrowserView;
  desktop: AgentDesktopView | null;
  capturedAt: string;
}

/** Reads the attempt's browser and desktop access without starting or changing either. */
export const readAgentScreen = (runId: string, capture: boolean) =>
  nativeTask<AgentScreen>('task_agent_screen', { runId, capture });

export const revokeAgentAccess = (runId: string, target: 'browser' | 'desktop') =>
  nativeTask<void>('task_agent_screen_revoke', { runId, target });

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
      return { label: 'Working in the window', tone: 'accent' as const };
    default:
      return { label: 'Ended', tone: 'default' as const };
  }
}
