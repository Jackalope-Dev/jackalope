import { Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useEffect, useId } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useUpdateStore } from '../../stores/updateStore';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { ReleaseNotes } from './ReleaseNotes';

export function UpdateSettings({ showHeading = true }: { showHeading?: boolean }) {
  const update = useUpdateStore();
  const channelId = useId();
  const runs = useExecutionStore((state) => state.runs);
  const desktop = isTauriEnvironment();
  const blocked = runs.some(
    (run) =>
      run.persistenceError ||
      ['starting', 'running', 'stopping', 'interrupted'].includes(run.status),
  );
  useEffect(() => {
    void update.load();
  }, [update.load]);
  const { release, progress } = update;
  const busy = update.checking || update.installing || update.changingChannel;
  const percent = progress?.total
    ? Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))
    : null;
  return (
    <section className="space-y-3" aria-label="App updates">
      {showHeading && <h3 className="text-base font-medium">App updates</h3>}
      {release && <p className="settings-row-description">Version {release.currentVersion}</p>}
      {(!desktop || !release || release.storeManaged || !release.configured) && (
        <p className="settings-row-description">
          {!desktop
            ? 'Updates are available in the desktop app.'
            : !release
              ? 'Reading update settings…'
              : release.storeManaged
                ? 'Check for updates in Microsoft Store → Library.'
                : 'Updates aren’t configured for this build.'}
        </p>
      )}
      {release?.configured && release.betaAvailable && (
        <div className="space-y-2">
          <label htmlFor={channelId} className="block text-sm font-medium">
            Update channel
          </label>
          <Select
            id={channelId}
            className="settings-input"
            value={release.channel}
            disabled={busy}
            onValueChange={(value) => void update.setChannel(value as 'stable' | 'beta')}
          >
            <SelectItem value="stable">Stable</SelectItem>
            <SelectItem value="beta">Beta</SelectItem>
          </Select>
          {release.channel === 'beta' && (
            <p className="settings-row-description">
              Beta includes early changes. Switching to Stable waits for a newer release.
            </p>
          )}
        </div>
      )}
      {release?.configured && (
        <>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Automatically check for updates</p>
              <p className="settings-row-description">You choose when to install.</p>
            </div>
            <Switch
              label="Automatically check for updates"
              checked={update.autoCheck}
              onCheckedChange={update.setAutoCheck}
            />
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void update.check()}
            loading={update.checking}
            loadingLabel="Checking…"
          >
            Check for updates
          </Button>
          {update.lastChecked !== null &&
            !update.checking &&
            !update.error &&
            !release.availableVersion && (
              <p className="settings-row-description">You’re up to date.</p>
            )}
        </>
      )}
      {release?.availableVersion && (
        <div className="space-y-3">
          <p>Version {release.availableVersion} is available.</p>
          {release.notes && (
            <Disclosure>
              <DisclosureSummary className="task-summary">Release notes</DisclosureSummary>
              <ReleaseNotes notes={release.notes} />
            </Disclosure>
          )}
          {blocked && (
            <p className="text-sm" role="status">
              Finish active tasks, resolve interrupted work and save task history to install.
            </p>
          )}
          <Button
            disabled={busy || blocked}
            onClick={() => void update.install()}
            loading={update.installing}
            loadingLabel={
              progress?.phase === 'installing'
                ? 'Installing and reopening…'
                : percent === null
                  ? 'Downloading update…'
                  : `Downloading update… ${percent}%`
            }
          >
            Install and restart
          </Button>
          {update.installing && (
            <p className="settings-row-description" role="status">
              {progress?.phase === 'installing'
                ? 'Installing update…'
                : 'Keep Jackalope open while the update downloads.'}
            </p>
          )}
        </div>
      )}
      {update.error && (
        <p className="text-sm break-words" role="alert">
          {update.error}
          {!release && desktop && (
            <Button variant="ghost" onClick={() => void update.load()}>
              Retry
            </Button>
          )}
        </p>
      )}
    </section>
  );
}
