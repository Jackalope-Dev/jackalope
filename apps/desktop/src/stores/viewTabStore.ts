import { create } from 'zustand';

/** Devices: using other computers from here, or letting phones and computers use this one. */
export type DevicesTab = 'use' | 'share';

/**
 * The tab a page shows, kept outside the page so a link from elsewhere (Settings, a setup
 * button, the helper) can land on the right tab before the page mounts.
 */
export const useViewTabStore = create<{
  devices: DevicesTab;
  setDevices: (tab: DevicesTab) => void;
}>()((set) => ({
  devices: 'use',
  setDevices: (devices) => set({ devices }),
}));
