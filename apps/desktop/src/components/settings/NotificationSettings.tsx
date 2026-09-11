import { useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { useNotificationStore } from '../../stores/notificationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';
import { Setting, SettingGroup } from './Setting';

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
    <SettingGroup className="mt-6">
      <Setting
        title="OS task notifications"
        controlId="os-task-notifications"
        description="Use the preference above while Jackalope is in the background. Task content stays private."
      >
        <Switch
          id="os-task-notifications"
          label="OS task notifications"
          checked={osNotifications}
          disabled={!status?.supported}
          onCheckedChange={(osNotifications) => updateSettings({ osNotifications })}
        />
      </Setting>
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
          <InlineNotice tone="error">{error || status?.error}</InlineNotice>
        )}
        {result && <InlineNotice role="status">{result}</InlineNotice>}
      </div>
    </SettingGroup>
  );
}
