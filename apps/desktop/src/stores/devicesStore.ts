import { create } from 'zustand';

/** A setup flow the Devices map asks a section to open when it mounts or is already open. */
export type DevicesIntent = 'connect-host' | 'add-machine';

/**
 * What the Devices sections are doing right now, so the map above them shows the same truth:
 * a phone code waiting to be scanned, a host pairing in flight, and a revision that moves
 * whenever a section changes what is paired.
 */
export const useDevicesStore = create<{
  waitingForPhone: boolean;
  connectingHost: boolean;
  revision: number;
  intent: DevicesIntent | null;
  setWaitingForPhone: (waiting: boolean) => void;
  setConnectingHost: (connecting: boolean) => void;
  changed: () => void;
  request: (intent: DevicesIntent) => void;
  /** Takes the intent if it is this one, so it runs once. */
  consume: (intent: DevicesIntent) => boolean;
}>()((set, get) => ({
  waitingForPhone: false,
  connectingHost: false,
  revision: 0,
  intent: null,
  setWaitingForPhone: (waitingForPhone) => set({ waitingForPhone }),
  setConnectingHost: (connectingHost) => set({ connectingHost }),
  changed: () => set((state) => ({ revision: state.revision + 1 })),
  request: (intent) => set({ intent }),
  consume: (intent) => {
    if (get().intent !== intent) return false;
    set({ intent: null });
    return true;
  },
}));
