import { useEffect } from 'react';
import { useSettingsSyncStore } from '../../stores/settingsSyncStore';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';

export function SettingsSync() {
  const sync = useSettingsSyncStore();
  useEffect(() => {
    void sync.refresh();
  }, [sync.refresh]);
  return (
    <section className="space-y-4" aria-label="Settings sync">
      <div className="flex items-center justify-between gap-4">
        <span>Sync settings with my account</span>
        <Switch
          label="Sync settings with my account"
          checked={sync.enabled}
          disabled={!sync.available || (sync.busy && !sync.enabled)}
          onCheckedChange={(enabled) => void sync.configure(enabled)}
        />
      </div>
      <p className="settings-row-description">
        Save your app theme, companion reactions and notification preferences to your Jackalope
        account and restore them on your other desktops. Existing saved settings are restored when
        you first turn this on. Credentials, local paths, projects and task history stay on this
        device.
      </p>
      <p className="settings-row-description">
        Optional on each desktop. Turning it off stops uploads and downloads and keeps your local
        settings. The saved account copy remains. Account access checks continue independently.
      </p>
      {!sync.available && <p role="status">Connect an approved account to enable settings sync.</p>}
      {sync.available && (
        <div className="space-y-2">
          <Button variant="outline" disabled={sync.busy} onClick={() => void sync.remove()}>
            Delete synced settings
          </Button>
          <p className="settings-row-description">
            Removes the saved account copy and turns sync off on all connected desktops. Local
            settings stay intact. Turn sync on again to save a new copy.
          </p>
        </div>
      )}
      {sync.enabled && !sync.error && !sync.conflict && (
        <p role="status">
          {sync.busy
            ? 'Syncing settings…'
            : sync.lastSynced
              ? 'Settings are synced.'
              : 'Ready to sync.'}
        </p>
      )}
      {sync.conflict && (
        <div className="space-y-3">
          <p role="status">
            Settings changed here and on another desktop. Choose which settings to keep.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={sync.busy} onClick={() => void sync.resolve('local')}>
              Use this desktop’s settings
            </Button>
            <Button
              variant="outline"
              disabled={sync.busy}
              onClick={() => void sync.resolve('remote')}
            >
              Use saved settings
            </Button>
          </div>
        </div>
      )}
      {sync.error && (
        <div className="space-y-2">
          <p role="alert">{sync.error}</p>
          <Button
            variant="outline"
            disabled={sync.busy}
            onClick={() => void sync.retry()}
          >
            Retry
          </Button>
        </div>
      )}
    </section>
  );
}
