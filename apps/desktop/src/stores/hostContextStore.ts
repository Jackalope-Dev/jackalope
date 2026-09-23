import { create } from 'zustand';
export const useHostContextStore = create<{
  host: { name: string; wsl: boolean; address: string } | null;
}>(() => ({ host: null }));
