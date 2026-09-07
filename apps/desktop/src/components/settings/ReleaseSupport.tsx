import { useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { FeedbackForm } from './FeedbackForm';
import { UpdateSettings } from './UpdateSettings';

export function ReleaseSupport() {
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [feedback, setFeedback] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const desktop = isTauriEnvironment();
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
      <UpdateSettings />
      <FeedbackForm />
      <section className="space-y-3" aria-label="Support report">
        <h3 className="text-base font-medium">Prepare a local support report</h3>
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
