import { useEffect } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useSettingsStore } from '../../stores/settingsStore';

export function DesktopExperience() {
  const zoom = useSettingsStore((state) => state.interfaceZoom);
  useEffect(() => {
    const value = Number.isFinite(zoom) ? Math.max(0.8, Math.min(1.5, zoom)) : 1;
    if (isTauriEnvironment()) {
      void nativeTask('desktop_zoom', { zoom: value }).catch(() => {});
    } else {
      document.documentElement.style.zoom = String(value);
      document.documentElement.style.setProperty('--interface-zoom', String(value));
    }
  }, [zoom]);
  return null;
}
