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
}

export interface AttachSupport {
  drag: boolean;
  pick: boolean;
}

/** Emitted while dragging with the window under the pointer, or null. */
export const GLOB_TARGET_EVENT = 'desktop-glob-target';

export function attachSupport(): Promise<AttachSupport> {
  if (!isTauriEnvironment()) return Promise.resolve({ drag: false, pick: false });
  return invokeNative<AttachSupport>('desktop_attach_support');
}

export const attachWindows = () => invokeNative<AttachTarget[]>('desktop_attach_windows');

export const confirmAttach = (conversation: string, handle: string, control: boolean) =>
  invokeNative<AttachedWindow>('desktop_attach_confirm', { conversation, handle, control });

export const attachedWindow = (conversation: string) =>
  invokeNative<AttachedWindow | null>('desktop_attach_get', { conversation });

export const clearAttached = (conversation: string) =>
  invokeNative<void>('desktop_attach_clear', { conversation });

export const startGlob = (conversation: string, provider: string) =>
  invokeNative<void>('desktop_glob_start', { conversation, provider });

/** Ends a drag; a drop returns the window under the pointer, for the person to confirm. */
export const endGlob = (drop: boolean) =>
  invokeNative<AttachTarget | null>('desktop_glob_end', { drop });

/** The line added to the composer, so the next message tells the agent about the window. */
export function attachMessage(window: AttachedWindow) {
  const name = `"${window.title}" window (${window.app})`;
  return window.control
    ? `I attached my ${name}. Use desktop control to read it and work in it.`
    : `I attached my ${name} for reading. Use desktop control to read it.`;
}
