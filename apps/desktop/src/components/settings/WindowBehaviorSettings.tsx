import { InlineNotice, SettingBody, SettingGroup, SettingRow, Switch } from '@jackalope/ui';
import { useState } from 'react';
import { describeError } from '../../lib/errors';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { useNativeResource } from '../../hooks/useNativeResource';

interface DesktopSettings {
  closeToTray: boolean;
  trayAvailable: boolean;
  launchAtLogin: boolean;
}

export function WindowBehaviorSettings() {
  const [saving, setSaving] = useState(false);
  const native = isTauriEnvironment();
  const {
    data: settings,
    setData: setSettings,
    error,
    setError,
  } = useNativeResource(() => invokeNative<DesktopSettings>('desktop_settings'), [], {
    enabled: native,
  });

  const update = async (enabled: boolean) => {
    if (!settings || saving) return;
    setSaving(true);
    setError('');
    try {
      await invokeNative('desktop_set_close_to_tray', { enabled });
      setSettings({ ...settings, closeToTray: enabled });
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setSaving(false);
    }
  };

  const updateLaunchAtLogin = async (enabled: boolean) => {
    if (!settings || saving) return;
    setSaving(true);
    setError('');
    try {
      await invokeNative('desktop_set_launch_at_login', { enabled });
      setSettings({ ...settings, launchAtLogin: enabled });
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingGroup title="Window & startup">
      <SettingRow
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
      </SettingRow>
      <SettingRow
        title="Launch at login"
        controlId="launch-at-login"
        descriptionId="launch-at-login-description"
        description="Start Jackalope automatically when you sign in."
      >
        <Switch
          id="launch-at-login"
          label="Launch at login"
          aria-describedby="launch-at-login-description"
          checked={settings?.launchAtLogin ?? false}
          disabled={!settings || saving}
          onCheckedChange={updateLaunchAtLogin}
        />
      </SettingRow>
      {((settings && !settings.trayAvailable) || error) && (
        <SettingBody>
          {settings && !settings.trayAvailable && (
            <InlineNotice tone="warning">
              System tray unavailable. Closing quits Jackalope.
            </InlineNotice>
          )}
          {error && (
            <InlineNotice tone="error">
              Could not save or load window preferences: {error}
            </InlineNotice>
          )}
        </SettingBody>
      )}
    </SettingGroup>
  );
}
