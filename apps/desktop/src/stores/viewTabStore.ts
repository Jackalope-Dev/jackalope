import { create } from 'zustand';

/** Devices: using other computers from here, letting phones and computers use this one, or
    cloud machines for bots and tasks. */
export type DevicesTab = 'use' | 'share' | 'cloud';

/**
 * The tab a page shows, kept outside the page so a link from elsewhere (Settings, a setup
 * button, the helper) can land on the right tab before the page mounts.
 */
export const useViewTabStore = create<{
  devices: DevicesTab;
  setDevices: (tab: DevicesTab) => void;
}>()((set) => ({
  devices: 'share',
  setDevices: (devices) => set({ devices }),
}));
