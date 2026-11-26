import { isTauriEnvironment } from './native/env.ts';
import { invokeNative } from './native/transport.ts';
import { trackAction } from './usage-events.ts';

/** A window the person can attach to a conversation. */
export interface AttachTarget {
  handle: string;
  title: string;
  app: string;
}

/** The window waiting for the conversation's agent to ask for it. */
export interface AttachedWindow {
  title: string;
  app: string;
  /** Allowed to click and type, not only read. */
  control: boolean;
  /** Minutes left before it stops waiting for the agent. */
  minutesLeft: number;
  /** Used by a turn already, so it stays attached for the rest of the conversation. */
  kept: boolean;
}

export interface AttachSupport {
  drag: boolean;
  pick: boolean;
  /** A badge rides on the attached window. */
  badge: boolean;
}

/** What an attached window's badge shows. */
export interface BadgeState extends AttachedWindow {
  /** The conversation id, or a `draft:` key before Send creates one. */
  key: string;
  draft: boolean;
  agent: string;
  /** The agent's character. */
  provider: string;
  /** Control was paused when the agent's turn ended; Resume picks it back up. */
  resumable: boolean;
  /** The conversation's agent is working right now. */
  running: boolean;
}

/** Emitted while dragging with the window under the pointer, or null. */
export const GLOB_TARGET_EVENT = 'desktop-glob-target';
/** Emitted when a drag starts, with the agent to draw. */
export const GLOB_BEGIN_EVENT = 'desktop-glob-begin';
/** Emitted when a drag ends: `drop` splats, `return` springs home toward `dx`, `dy`. */
export const GLOB_FINISH_EVENT = 'desktop-glob-finish';
/** Emitted when a drag ends, natively or from the app, with the window dropped on. */
export const GLOB_DROPPED_EVENT = 'desktop-glob-dropped';
export interface GlobDropped {
  target: AttachTarget | null;
  canceled: boolean;
}
/** Tells the window frame how to draw: around the target, around a just-attached window, or not. */
export const GLOB_FRAME_EVENT = 'desktop-glob-frame';
export type GlobFrameMode = 'target' | 'attached' | 'off';
/** Asks the badge with this window label to bounce. */
export const BADGE_PULSE_EVENT = 'desktop-badge-pulse';
/** Emitted with a conversation key when its window was detached outside the app. */
export const ATTACH_CHANGED_EVENT = 'desktop-attach-changed';
/** A badge asks the draft's composer to send a question; it answers with the result. */
export const ATTACH_ASK_EVENT = 'desktop-attach-ask';
export const ATTACH_ASK_RESULT_EVENT = 'desktop-attach-ask-result';
/** The badge's Open asks the main window to show a project's new-work composer. */
export const ATTACH_OPEN_DRAFT_EVENT = 'desktop-attach-open-draft';

export interface AttachAsk {
  requestId: string;
  key: string;
  text: string;
}

export interface AttachAskResult {
  requestId: string;
  error?: string;
  /** The conversation the question started. */
  conversation?: string;
}

/** The help guide section that explains attaching windows. */
export const ATTACH_HELP_URL =
  'https://jackalope.dev/knowledge/windows-desktop-control/#attach-window';

export function attachSupport(): Promise<AttachSupport> {
  if (!isTauriEnvironment()) return Promise.resolve({ drag: false, pick: false, badge: false });
  return invokeNative<AttachSupport>('desktop_attach_support');
}

export const attachWindows = () => invokeNative<AttachTarget[]>('desktop_attach_windows');

export const confirmAttach = (
  conversation: string,
  handle: string,
  control: boolean,
  agent: string,
  provider: string,
  site: string | null,
) =>
  invokeNative<AttachedWindow>('desktop_attach_confirm', {
    conversation,
    handle,
    control,
    agent,
    provider,
    site,
  }).then((attached) => {
    trackAction('window_attached');
    return attached;
  });

/** The website open in a browser window, which attaching it allows; null for other apps. */
export const attachSite = (conversation: string, handle: string) =>
  invokeNative<string | null>('desktop_attach_site', { conversation, handle });

export const attachedWindow = (conversation: string) =>
  invokeNative<AttachedWindow | null>('desktop_attach_get', { conversation });

export const clearAttached = (conversation: string) =>
  invokeNative<void>('desktop_attach_clear', { conversation });

/** Shows where an attached window is: its outline glows again and its badge bounces. */
export const revealAttached = (conversation: string) =>
  invokeNative<void>('desktop_attach_reveal', { conversation });

/** Where the new-work composer stages a window before Send creates a conversation. */
export const draftAttachKey = (projectId: string) => `draft:${projectId}`;

/**
 * Moves a draft's window to the conversation Send is creating, or back when creating it
 * failed. Resolves to whether a window moved.
 */
export const handOffAttached = (from: string, to: string) =>
  invokeNative<boolean>('desktop_attach_hand_off', { from, to });

/** Detaches every draft window except `keep`'s. */
export const clearDraftAttachments = (keep?: string) =>
  invokeNative<void>('desktop_attach_clear_drafts', { keep });

/** Builds the drag overlay ahead of time, so its first frame has painted before a drag. */
export const prepareGlob = () => invokeNative<void>('desktop_glob_prepare');

export const startGlob = (conversation: string, provider: string) =>
  invokeNative<void>('desktop_glob_start', { conversation, provider });

/** Ends a drag from the app; the outcome arrives as `GLOB_DROPPED_EVENT`. */
export const endGlob = (drop: boolean) =>
  invokeNative<AttachTarget | null>('desktop_glob_end', { drop });

/** One line in the dev app's drag trace (`glob:` in its terminal output). */
export function globLog(message: string) {
  if (!isTauriEnvironment()) return;
  void invokeNative<void>('desktop_glob_log', { message }).catch(() => undefined);
}

/** The overlay or badge page painted its first transparent frame. */
export const overlayReady = () => invokeNative<void>('desktop_overlay_ready');

export const badgeState = () => invokeNative<BadgeState>('desktop_badge_state');
export const resizeBadge = (expanded: boolean) =>
  invokeNative<void>('desktop_badge_resize', { expanded });
export const detachFromBadge = () => invokeNative<void>('desktop_badge_detach');
export const openFromBadge = () => invokeNative<void>('desktop_badge_open');
/** The badge's Resume; wakes an idle conversation once. */
export const resumeFromBadge = () =>
  invokeNative<{ sent: boolean; running: boolean }>('desktop_badge_resume');

/** The line added to the composer, so the next message tells the agent about the window. */
export function attachMessage(window: Pick<AttachedWindow, 'title' | 'app' | 'control'>) {
  const name = `"${window.title}" window (${window.app})`;
  return window.control
    ? `I attached my ${name}. Use desktop control to read it and work in it.`
    : `I attached my ${name} for reading. Use desktop control to read it.`;
}
