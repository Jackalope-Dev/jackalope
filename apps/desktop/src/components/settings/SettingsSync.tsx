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
        Sync app appearance, companion reactions and notification preferences. The first sync
        restores your saved preferences. Credentials, paths, projects and task history stay local.
      </p>
      <p className="settings-row-description">
        Optional on each desktop. Turning it off stops transfers and keeps both local settings and
        the saved copy. Account access checks continue.
      </p>
      {!sync.owner && <p role="status">{sync.enabled ? 'Sync starts after you connect an approved account.' : 'Connect an approved account to sync settings.'}</p>}
      {sync.owner && (
        <div className="space-y-2">
          <Button variant="outline" disabled={sync.busy} onClick={() => void sync.remove()}>
            Delete synced settings
          </Button>
          <p className="settings-row-description">
            Removes the saved copy and disables sync on all desktops. Local settings stay intact.
          </p>
        </div>
      )}
      {sync.enabled && sync.owner && !sync.error && !sync.conflict && (
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
          <Button variant="outline" disabled={sync.busy} onClick={() => void sync.retry()}>
            Retry
          </Button>
        </div>
      )}
    </section>
  );
}
