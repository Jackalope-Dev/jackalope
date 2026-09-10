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
      setResult('Sent to your desktop. If it did not appear, check system notification settings.');
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
            Use the preference above while Jackalope is in the background. Task content stays
            private.
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
      <div className="space-y-3 px-5 py-4">
        <p className="task-muted">
          {!status?.supported
            ? 'Available in the desktop app.'
            : 'Notifications stop when Jackalope quits.'}
        </p>
        {status?.supported && (
          <Button variant="outline" disabled={busy} onClick={() => void test()}>
            {busy ? 'Sending…' : 'Send test notification'}
          </Button>
        )}
        {(error || status?.error) && (
          <p role="alert" className="task-error">
            {error || status?.error}
          </p>
        )}
        {result && (
          <p role="status" className="task-muted">
            {result}
          </p>
        )}
      </div>
    </div>
  );
}
