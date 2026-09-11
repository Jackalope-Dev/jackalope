import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';
import { Setting, SettingGroup } from './Setting';

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
      <SettingGroup className="mt-6">
        <Setting
          title="Close to system tray"
          controlId="close-to-tray"
          descriptionId="close-to-tray-description"
          description="Keep tasks running when the window closes."
        >
          <Switch
            id="close-to-tray"
            label="Close to system tray"
            aria-describedby="close-to-tray-description"
            checked={settings?.closeToTray ?? true}
            disabled={!settings?.trayAvailable || saving}
            onCheckedChange={update}
          />
        </Setting>
      </SettingGroup>
      {settings && !settings.trayAvailable && (
        <InlineNotice tone="warning">
          System tray unavailable. Closing quits Jackalope.
        </InlineNotice>
      )}
      {error && (
        <InlineNotice tone="error">Could not save or load window preferences: {error}</InlineNotice>
      )}
    </>
  );
}
