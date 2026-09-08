import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Switch } from '../ui/Switch';

interface DesktopSettings {
  closeToTray: boolean;
  trayAvailable: boolean;
}

export function WindowBehaviorSettings() {
  const [settings, setSettings] = useState<DesktopSettings>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const native = isTauriEnvironment();

  useEffect(() => {
    if (!native) return;
    let active = true;
    nativeTask<DesktopSettings>('desktop_settings').then(
      (value) => {
        if (active) setSettings(value);
      },
      (reason) => {
        if (active) setError(String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [native]);

  const update = async (enabled: boolean) => {
    if (!settings || saving) return;
    setSaving(true);
    setError('');
    try {
      await nativeTask('desktop_set_close_to_tray', { enabled });
      setSettings({ ...settings, closeToTray: enabled });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="settings-group-card mt-6">
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Close to system tray</div>
            <p id="close-to-tray-description" className="settings-row-description">
              Keep tasks running when the window closes.
            </p>
          </div>
          <div className="settings-control-wrapper">
            <Switch
              label="Close to system tray"
              aria-describedby="close-to-tray-description"
              checked={settings?.closeToTray ?? true}
              disabled={!settings?.trayAvailable || saving}
              onCheckedChange={update}
            />
          </div>
        </div>
      </div>
      {settings && !settings.trayAvailable && (
        <p className="settings-disclosure-box">System tray unavailable. Closing quits Jackalope.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          Could not save or load window preferences: {error}
        </p>
      )}
    </>
  );
}
