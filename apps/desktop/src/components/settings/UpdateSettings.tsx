import { useEffect } from 'react';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useExecutionStore } from '../../stores/executionStore';
import { useUpdateStore } from '../../stores/updateStore';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';

export function UpdateSettings() {
  const update = useUpdateStore();
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
  const busy = update.checking || update.installing;
  const percent = progress?.total
    ? Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))
    : null;
  return (
    <section className="space-y-3" aria-label="App updates">
      <h3 className="text-base font-medium">
        App updates{release ? ` · ${release.currentVersion}` : ''}
      </h3>
      <p className="settings-row-description">
        {!desktop
          ? 'Updates are available in the desktop app.'
          : !release
            ? 'Reading update settings…'
            : !release.configured
              ? 'This local build has no configured update service.'
              : 'Get new improvements without reinstalling manually. You choose when to install; Jackalope closes and reopens.'}
      </p>
      {release?.configured && (
        <>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Automatically check for updates</p>
              <p className="settings-row-description">
                Check on startup and every six hours while open. Downloads begin only when you
                choose Install.
              </p>
            </div>
            <Switch
              label="Automatically check for updates"
              checked={update.autoCheck}
              onCheckedChange={update.setAutoCheck}
            />
          </div>
          <Button variant="outline" disabled={busy} onClick={() => void update.check()}>
            {update.checking ? 'Checking…' : 'Check for updates'}
          </Button>
          {update.lastChecked !== null && !update.checking && (
            <p className="settings-row-description">
              Last checked {new Date(update.lastChecked).toLocaleString()}.
              {!release.availableVersion && !update.error
                ? ' You have the latest available version.'
                : ''}
            </p>
          )}
        </>
      )}
      {release?.availableVersion && (
        <div className="space-y-3">
          <p>Version {release.availableVersion} is available.</p>
          {release.notes && (
            <details>
              <summary className="task-summary">Release notes</summary>
              <p className="whitespace-pre-wrap break-words text-sm mt-2">{release.notes}</p>
            </details>
          )}
          {blocked && (
            <p className="text-sm" role="status">
              Finish active tasks, resolve interrupted work, and save task history before
              installing.
            </p>
          )}
          <Button disabled={busy || blocked} onClick={() => void update.install()}>
            {update.installing
              ? progress?.phase === 'installing'
                ? 'Installing and reopening…'
                : percent === null
                  ? 'Downloading update…'
                  : `Downloading update… ${percent}%`
              : 'Install update and reopen'}
          </Button>
          {update.installing && (
            <p className="settings-row-description" role="status">
              {progress?.phase === 'installing'
                ? 'Download complete. Verifying and installing the signed update…'
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
