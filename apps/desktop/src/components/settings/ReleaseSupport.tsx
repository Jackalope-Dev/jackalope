import { useEffect, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';

interface ReleaseStatus {
  currentVersion: string;
  configured: boolean;
  availableVersion: string | null;
  notes: string | null;
}

export function ReleaseSupport() {
  const [release, setRelease] = useState<ReleaseStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [feedback, setFeedback] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const desktop = isTauriEnvironment();
  useEffect(() => {
    if (!desktop) return;
    let canceled = false;
    nativeTask<ReleaseStatus>('app_release_status', { check: false })
      .then((result) => {
        if (!canceled) setRelease(result);
      })
      .catch((error) => {
        if (!canceled) setMessage(String(error));
      });
    return () => {
      canceled = true;
    };
  }, [desktop]);
  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!diagnostics) return;
    await navigator.clipboard.writeText(
      JSON.stringify({ diagnostics, feedback: feedback.trim() || undefined }, null, 2),
    );
    setMessage('Report copied. Review it before sharing it with support. Nothing was sent.');
  };
  return (
    <div className="space-y-6">
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
                : 'Check for a signed update when you’re ready. Installation closes Jackalope; finish your work first.'}
        </p>
        {release?.configured && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const status = await nativeTask<ReleaseStatus>('app_release_status', {
                  check: true,
                });
                setRelease(status);
                if (!status.availableVersion) setMessage('You have the latest available version.');
              })
            }
          >
            {busy ? 'Please wait…' : 'Check for updates'}
          </Button>
        )}
        {release?.availableVersion && (
          <div className="space-y-3">
            <p>Version {release.availableVersion} is available.</p>
            {release.notes && (
              <details>
                <summary className="task-summary">Release notes</summary>
                <p className="whitespace-pre-wrap text-sm mt-2">{release.notes}</p>
              </details>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await nativeTask('app_install_update', { version: release.availableVersion });
                })
              }
            >
              {busy ? 'Downloading and installing…' : 'Install update and reopen'}
            </Button>
          </div>
        )}
      </section>
      <section className="space-y-3" aria-label="Support report">
        <h3 className="text-base font-medium">Get help or share feedback</h3>
        <p className="settings-row-description">
          Prepare a local report with app version, OS, and task outcome counts. It excludes account
          names, credentials, project paths, prompts, code, and command output. Nothing is sent
          automatically.
        </p>
        <Button
          variant="outline"
          disabled={!desktop || busy}
          onClick={() =>
            void act(async () =>
              setDiagnostics(await nativeTask<Record<string, unknown>>('app_diagnostics')),
            )
          }
        >
          Preview support report
        </Button>
        {diagnostics && (
          <>
            <details open>
              <summary className="task-summary">Report contents</summary>
              <pre className="task-output mt-3">{JSON.stringify(diagnostics, null, 2)}</pre>
            </details>
            <label htmlFor="support-feedback" className="block text-sm font-medium">
              What were you trying to do, and what happened?
            </label>
            <textarea
              id="support-feedback"
              className="settings-textarea"
              rows={4}
              maxLength={8000}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Include steps to reproduce or a suggestion. Leave out sensitive information."
            />
            <Button variant="outline" disabled={busy} onClick={() => void act(copy)}>
              Copy report and feedback
            </Button>
          </>
        )}
      </section>
      {message && (
        <p className="text-sm break-words" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
