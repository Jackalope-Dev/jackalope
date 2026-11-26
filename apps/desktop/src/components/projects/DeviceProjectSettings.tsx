import { describeError } from '@jackalope/contracts/errors';
import { Button, InlineNotice, SettingBody, SettingGroup, SettingRow } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { devicePermissions, forgetDevice, type RememberedDevice } from '../../lib/devices';
import { isTauriEnvironment } from '../../lib/native/env';

/** iPhones and iPads allowed for every conversation in one project, each removable. */
export function DeviceProjectSettings({ projectId }: { projectId: string }) {
  const [devices, setDevices] = useState<RememberedDevice[]>([]);
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let current = true;
    setError('');
    void devicePermissions(projectId)
      .then((value) => current && setDevices(value))
      .catch((cause) => current && setError(describeError(cause)));
    return () => {
      current = false;
    };
  }, [projectId]);

  const remove = async (id: string) => {
    setRemoving(id);
    setError('');
    try {
      await forgetDevice(projectId, id);
      setDevices((items) => items.filter((item) => item.id !== id));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setRemoving('');
    }
  };

  return (
    <SettingGroup
      title="iPhone and iPad"
      description="Devices you chose to always allow for agents in this project. Other devices are used only when you attach them to a conversation."
    >
      {error && (
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      )}
      {devices.length === 0 && !error && (
        <SettingBody>
          <p className="settings-section-subtitle">No device is always allowed.</p>
        </SettingBody>
      )}
      {devices.map((device) => (
        <SettingRow
          key={device.id}
          title={device.name}
          description={
            device.level === 'control'
              ? 'Always allowed: install, launch and stop apps, and read the console.'
              : 'Always allowed: list apps and read the console.'
          }
        >
          <Button
            variant="outline"
            loading={removing === device.id}
            loadingLabel="Removing…"
            disabled={!!removing}
            aria-label={`Remove ${device.name}`}
            onClick={() => void remove(device.id)}
          >
            Remove
          </Button>
        </SettingRow>
      ))}
    </SettingGroup>
  );
}
