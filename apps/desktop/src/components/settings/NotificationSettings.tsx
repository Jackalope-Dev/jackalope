import { useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { useNotificationStore } from '../../stores/notificationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';

export function NotificationSettings() {
  const { status, error } = useNotificationStore();
  const { osNotifications, updateSettings } = useSettingsStore();
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    setResult('');
    try {
      await nativeTask('notification_test');
      setResult('Sent to Windows. If it did not appear, check Windows notification settings.');
    } catch (error) {
      setResult(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-group-card mt-6">
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-label">OS task notifications</div>
          <p className="settings-row-description">
            Show questions, failures and review notices while Jackalope is in the background. Uses
            your notification preference above. Prompts and project names stay private.
          </p>
        </div>
        <div className="settings-control-wrapper">
          <Switch
            label="OS task notifications"
            checked={osNotifications}
            disabled={!status?.supported}
            onCheckedChange={(osNotifications) => updateSettings({ osNotifications })}
          />
        </div>
      </div>
      <p className="task-muted">
        {!status?.supported
          ? 'Available in the Windows desktop app. In-app notices remain available everywhere.'
          : 'Click a notification to open its task while Jackalope is running. Quit stops background notifications. Windows can silence delivery; development notifications may appear under PowerShell.'}
      </p>
      {status?.supported && (
        <Button className="mt-3" variant="outline" disabled={busy} onClick={() => void test()}>
          {busy ? 'Sending…' : 'Send test notification'}
        </Button>
      )}
      {(error || status?.error) && (
        <p role="alert" className="task-error">
          {error || status?.error}
        </p>
      )}
      {result && (
        <p role="status" className="task-muted mt-3">
          {result}
        </p>
      )}
    </div>
  );
}
