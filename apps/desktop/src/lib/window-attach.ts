import { isTauriEnvironment } from './native/env.ts';
import { invokeNative } from './native/transport.ts';

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
}

/** Emitted while dragging with the window under the pointer, or null. */
export const GLOB_TARGET_EVENT = 'desktop-glob-target';
/** Emitted when a drag starts, with the agent to draw. */
export const GLOB_BEGIN_EVENT = 'desktop-glob-begin';
/** Emitted when a drag ends: `drop` splats, `return` springs home toward `dx`, `dy`. */
export const GLOB_FINISH_EVENT = 'desktop-glob-finish';
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
) =>
  invokeNative<AttachedWindow>('desktop_attach_confirm', {
    conversation,
    handle,
    control,
    agent,
    provider,
  });

export const attachedWindow = (conversation: string) =>
  invokeNative<AttachedWindow | null>('desktop_attach_get', { conversation });

export const clearAttached = (conversation: string) =>
  invokeNative<void>('desktop_attach_clear', { conversation });

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

/** Ends a drag; a drop returns the window under the pointer, for the person to confirm. */
export const endGlob = (drop: boolean) =>
  invokeNative<AttachTarget | null>('desktop_glob_end', { drop });

/** The overlay or badge page painted its first transparent frame. */
export const overlayReady = () => invokeNative<void>('desktop_overlay_ready');

export const badgeState = () => invokeNative<BadgeState>('desktop_badge_state');
export const resizeBadge = (expanded: boolean) =>
  invokeNative<void>('desktop_badge_resize', { expanded });
export const detachFromBadge = () => invokeNative<void>('desktop_badge_detach');
export const openFromBadge = () => invokeNative<void>('desktop_badge_open');

/** The line added to the composer, so the next message tells the agent about the window. */
export function attachMessage(window: Pick<AttachedWindow, 'title' | 'app' | 'control'>) {
  const name = `"${window.title}" window (${window.app})`;
  return window.control
    ? `I attached my ${name}. Use desktop control to read it and work in it.`
    : `I attached my ${name} for reading. Use desktop control to read it.`;
}
