import {
  Button,
  InlineNotice,
  Select,
  SelectItem,
  SettingActions,
  SettingBody,
  SettingGroup,
  SettingRow,
  Switch,
} from '@jackalope/ui';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { describeError } from '../../lib/errors';
import { invokeNative } from '../../lib/native/transport';
import { useNotificationStore } from '../../stores/notificationStore';
import { type NotificationLevel, useSettingsStore } from '../../stores/settingsStore';

export function NotificationSettings() {
  const { status, error } = useNotificationStore(
    useShallow((s) => ({ status: s.status, error: s.error })),
  );
  const { osNotifications, notifications, updateSettings } = useSettingsStore(
    useShallow((s) => ({
      osNotifications: s.osNotifications,
      notifications: s.notifications,
      updateSettings: s.updateSettings,
    })),
  );
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    setResult('');
    try {
      await invokeNative('notification_test');
      setResult('Sent to your desktop. If it did not appear, check system notification settings.');
    } catch (error) {
      setResult(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingGroup title="Notifications">
      <SettingRow
        title="Which task updates to show"
        description="Applies to the in-app companion and to system notifications."
      >
        <Select
          aria-label="Which task updates to show"
          value={notifications}
          onValueChange={(value) => updateSettings({ notifications: value as NotificationLevel })}
        >
          <SelectItem value="all">All notifications</SelectItem>
          <SelectItem value="failures-only">Needs attention only</SelectItem>
          <SelectItem value="none">Quiet</SelectItem>
        </Select>
      </SettingRow>
      <SettingRow
        title="System notifications"
        controlId="os-task-notifications"
        description={
          status?.supported
            ? 'Shown while Jackalope is in the background and stop when it quits. Task content stays private.'
            : 'Available in the desktop app.'
        }
      >
        <Switch
          id="os-task-notifications"
          label="OS task notifications"
          checked={osNotifications}
          disabled={!status?.supported}
          onCheckedChange={(osNotifications) => updateSettings({ osNotifications })}
        />
      </SettingRow>
      {status?.supported && (
        <SettingActions>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void test()}
            loading={busy}
            loadingLabel="Sending…"
          >
            Send test notification
          </Button>
        </SettingActions>
      )}
      {(error || status?.error || result) && (
        <SettingBody>
          {(error || status?.error) && (
            <InlineNotice tone="error">{error || status?.error}</InlineNotice>
          )}
          {result && <InlineNotice role="status">{result}</InlineNotice>}
        </SettingBody>
      )}
    </SettingGroup>
  );
}
