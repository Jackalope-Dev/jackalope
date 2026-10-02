import { DiscordIcon, FormField, Textarea } from '@jackalope/ui';
import { LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { DISCORD_URL } from '../../lib/community';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment, openExternalUrl } from '../../lib/tauri-bridge';
import { Button } from '../ui/button';
import { FeedbackForm } from './FeedbackForm';
import { Setting, SettingActions, SettingBody, SettingGroup } from './Setting';
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
    <>
      <UpdateSettings />
      <FeedbackForm />
      <SettingGroup aria-label="Help and community">
        <Setting
          title="Documentation & guides"
          description="Architecture guides, agent configuration, worktree workflows and troubleshooting recipes in the online Knowledgebase."
        >
          <Button
            variant="outline"
            onClick={() => void openExternalUrl('https://jackalope.dev/knowledge/')}
          >
            <LifeBuoy className="size-4 mr-2" />
            Browse Knowledgebase
          </Button>
        </Setting>
        <Setting
          title="Community"
          description="Ask questions, share workflows and hear about new releases first in the Jackalope Discord."
        >
          <Button variant="outline" onClick={() => void openExternalUrl(DISCORD_URL)}>
            <DiscordIcon className="size-4 mr-2" />
            Join the Discord
          </Button>
        </Setting>
      </SettingGroup>
      <SettingGroup
        aria-label="Support report"
        title="Prepare a local support report"
        description="Includes app version, OS and task outcome counts. Excludes account names, credentials, project paths, prompts, code and command output. Nothing is sent automatically."
        action={
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
        }
      >
        {diagnostics && (
          <>
            <SettingBody aria-label="Support report contents">
              <pre className="task-output">{JSON.stringify(diagnostics, null, 2)}</pre>
              <FormField label="What were you trying to do, and what happened?">
                <Textarea
                  id="support-feedback"
                  className="settings-textarea"
                  rows={4}
                  maxLength={8000}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="Include steps to reproduce or a suggestion. Leave out sensitive information."
                />
              </FormField>
            </SettingBody>
            <SettingActions>
              <Button variant="outline" disabled={busy} onClick={() => void act(copy)}>
                Copy report and feedback
              </Button>
            </SettingActions>
          </>
        )}
        {message && (
          <SettingBody>
            <p className="text-sm break-words" role="status">
              {message}
            </p>
          </SettingBody>
        )}
      </SettingGroup>
    </>
  );
}
