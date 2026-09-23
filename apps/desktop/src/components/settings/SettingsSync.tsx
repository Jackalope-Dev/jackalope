import { Disclosure, DisclosureSummary } from '@jackalope/ui';
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
        Keep appearance, companion and notification preferences across desktops. Credentials,
        projects and task history stay local.
      </p>
      <Disclosure className="space-y-2">
        <DisclosureSummary className="min-h-11 cursor-pointer py-3 text-sm rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
          How sync works
        </DisclosureSummary>
        <p className="settings-row-description">
          The first sync restores saved preferences. Paths stay local. Sync is optional on each
          desktop; turning it off keeps local settings and the saved copy. Account access checks
          continue.
        </p>
      </Disclosure>
      {!sync.owner && (
        <p role="status">
          {sync.enabled
            ? 'Sync starts after you connect an approved account.'
            : 'Connect an approved account to sync settings.'}
        </p>
      )}
      {sync.owner && (
        <div className="space-y-2">
          <Button variant="outline" disabled={sync.busy} onClick={() => void sync.remove()}>
            Delete synced settings
          </Button>
          <p className="settings-row-description">
            Deletes the cloud copy and turns sync off everywhere. Keeps local settings.
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
