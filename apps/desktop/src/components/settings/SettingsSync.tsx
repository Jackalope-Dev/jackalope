import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useEffect } from 'react';
import { lessonSyncStatus } from '../../lib/lesson-sync';
import { useLessonSyncStore } from '../../stores/lessonSyncStore';
import { useSettingsSyncStore } from '../../stores/settingsSyncStore';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';
import { Setting, SettingBody, SettingGroup } from './Setting';

export function SettingsSync() {
  const sync = useSettingsSyncStore();
  useEffect(() => {
    void sync.refresh();
  }, [sync.refresh]);
  return (
    <SettingGroup aria-label="Settings sync">
      <Setting
        title="Sync settings with my account"
        description="Keep appearance, companion and notification preferences across desktops. Credentials, projects and task history stay local."
      >
        <Switch
          label="Sync settings with my account"
          checked={sync.enabled}
          disabled={!sync.available || (sync.busy && !sync.enabled)}
          onCheckedChange={(enabled) => void sync.configure(enabled)}
        />
      </Setting>
      <LessonSync settingsOn={sync.enabled && Boolean(sync.owner)} />
      <SettingBody>
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
            {sync.enabled ? 'Sync starts after you sign in.' : 'Sign in to sync settings.'}
          </p>
        )}
        {sync.owner && (
          <div className="space-y-2">
            <Button variant="outline" disabled={sync.busy} onClick={() => void sync.remove()}>
              Delete synced settings
            </Button>
            <p className="settings-row-description">
              Deletes the cloud copy, including synced lessons, and turns sync off everywhere. Keeps
              local settings and lessons.
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
      </SettingBody>
    </SettingGroup>
  );
}

function LessonSync({ settingsOn }: { settingsOn: boolean }) {
  const lessons = useLessonSyncStore();
  const { view } = lessons;
  return (
    <>
      <Setting
        title="Include learned lessons"
        description="Also sync lessons Jackalope learned, with their history, so every desktop signed in to this account uses them. Evidence, use counts and folder paths stay here. Exclude a project in its settings."
      >
        <Switch
          label="Include learned lessons"
          checked={view.enabled}
          disabled={!settingsOn || !view.available || lessons.busy}
          onCheckedChange={(enabled) => void lessons.configure(enabled)}
        />
      </Setting>
      <SettingBody>
        <p role="status">{lessonSyncStatus(view, lessons.busy)}</p>
        {view.enabled && (
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" disabled={lessons.busy} onClick={() => void lessons.sync()}>
              Sync lessons now
            </Button>
            <Button variant="outline" disabled={lessons.busy} onClick={() => void lessons.remove()}>
              Delete synced lessons
            </Button>
          </div>
        )}
        {view.enabled && (
          <p className="settings-row-description">
            Deleting removes the cloud copy and turns lesson sync off on every desktop. Lessons on
            each desktop stay.
          </p>
        )}
        {lessons.error && (
          <div className="space-y-2">
            <p role="alert">{lessons.error}</p>
            <Button
              variant="outline"
              disabled={lessons.busy}
              onClick={() => void lessons.refresh()}
            >
              Retry
            </Button>
          </div>
        )}
      </SettingBody>
    </>
  );
}
