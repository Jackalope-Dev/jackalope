import { create } from 'zustand';
import { nativeTask } from '../lib/task-runtime';
import { isTauriEnvironment } from '../lib/tauri-bridge';
import { useSettingsStore } from './settingsStore';

export interface NotificationStatus {
  supported: boolean;
  enabled: boolean;
  error: string | null;
}
export const useNotificationStore = create<{
  status?: NotificationStatus;
  error: string;
  refresh: () => Promise<void>;
}>((set) => ({
  error: '',
  refresh: async () => {
    if (!isTauriEnvironment()) return;
    try {
      set({ status: await nativeTask<NotificationStatus>('notification_status'), error: '' });
    } catch (error) {
      set({ error: String(error) });
    }
  },
}));

export function observeNotifications() {
  if (!isTauriEnvironment()) return;
  let alive = true;
  let pending = Promise.resolve();
  const sync = () => {
    const { osNotifications: enabled, notifications: level } = useSettingsStore.getState();
    pending = pending.then(async () => {
      if (!alive) return;
      try {
        const status = await nativeTask<NotificationStatus>('notification_configure', {
          preferences: { enabled, level },
        });
        if (alive) useNotificationStore.setState({ status, error: '' });
      } catch (error) {
        if (alive) useNotificationStore.setState({ error: String(error) });
      }
    });
  };
  sync();
  const unsubscribe = useSettingsStore.subscribe((state, previous) => {
    if (
      state.osNotifications !== previous.osNotifications ||
      state.notifications !== previous.notifications
    )
      sync();
  });
  const refresh = () => void useNotificationStore.getState().refresh();
  window.addEventListener('focus', refresh);
  let unlisten: (() => void) | undefined;
  void import('@tauri-apps/api/event')
    .then(async ({ listen }) => {
      const stop = await listen('jackalope-notification-status', refresh);
      if (alive) unlisten = stop;
      else stop();
    })
    .catch((error) => {
      if (alive) useNotificationStore.setState({ error: String(error) });
    });
  return () => {
    alive = false;
    unsubscribe();
    unlisten?.();
    window.removeEventListener('focus', refresh);
  };
}
