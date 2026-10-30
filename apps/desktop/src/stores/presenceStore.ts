import { useEffect } from 'react';
import { create } from 'zustand';
import { awaySince } from '../lib/catch-up';

/** Shared by every Jackalope window, so focus in any of them counts as being here. */
const LAST_PRESENT_KEY = 'jackalope-last-present-v1';
const WRITE_INTERVAL_MS = 30_000;

interface PresenceState {
  /** When the person left before their latest return; null when there is nothing to catch up on. */
  awaySince: string | null;
  returned: (since: string) => void;
  dismiss: () => void;
}

export const usePresenceStore = create<PresenceState>()((set) => ({
  awaySince: null,
  // An undismissed catch-up keeps its earlier start, so a second absence adds to it.
  returned: (since) => set((state) => ({ awaySince: state.awaySince ?? since })),
  dismiss: () => set({ awaySince: null }),
}));

function readLastPresent() {
  try {
    return localStorage.getItem(LAST_PRESENT_KEY);
  } catch {
    return null;
  }
}

function writeLastPresent(time: number) {
  try {
    localStorage.setItem(LAST_PRESENT_KEY, new Date(time).toISOString());
  } catch {
    // Without storage the catch-up simply never appears.
  }
}

/**
 * Records when the person is present (focus, pointer or keyboard input in a visible
 * window) and starts a catch-up when they return after being away long enough.
 */
export function usePresenceTracking() {
  useEffect(() => {
    let lastWrite = 0;
    const present = () => {
      if (document.hidden || !document.hasFocus()) return;
      const now = Date.now();
      if (now - lastWrite < WRITE_INTERVAL_MS) return;
      const since = awaySince(readLastPresent(), now);
      if (since) usePresenceStore.getState().returned(since);
      lastWrite = now;
      writeLastPresent(now);
    };
    const leave = () => {
      // Leaving counts as the last moment present, even between throttled writes.
      if (lastWrite) writeLastPresent(Date.now());
      lastWrite = 0;
    };
    const visibility = () => (document.hidden ? leave() : present());
    present();
    window.addEventListener('focus', present);
    window.addEventListener('blur', leave);
    window.addEventListener('pointerdown', present, { passive: true });
    window.addEventListener('pointermove', present, { passive: true });
    window.addEventListener('keydown', present);
    window.addEventListener('wheel', present, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', present);
      window.removeEventListener('blur', leave);
      window.removeEventListener('pointerdown', present);
      window.removeEventListener('pointermove', present);
      window.removeEventListener('keydown', present);
      window.removeEventListener('wheel', present);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
}
