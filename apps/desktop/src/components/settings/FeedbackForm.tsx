import { useEffect, useRef, useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useCommunityStore } from '../../stores/communityStore';
import { useFeedbackStore } from '../../stores/feedbackStore';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';

type Counts = { attempts: number; reviewed: number; failed: number; historySaveFailures: number };
type Report = {
  id: string;
  kind: 'bug' | 'feature' | 'idea';
  message: string;
  diagnostics?: Counts;
};
export function FeedbackForm({
  invited = false,
  onSubmitted,
}: {
  invited?: boolean;
  onSubmitted?: () => void;
}) {
  const settings = useCommunityStore((s) => s.settings);
  const [kind, setKind] = useState<Report['kind']>(invited ? 'idea' : 'bug');
  const messageInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (invited) messageInput.current?.focus();
  }, [invited]);
  const [message, setMessage] = useState('');
  const [include, setInclude] = useState(false);
  const [preview, setPreview] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const locked = useRef(false);
  const act = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setStatus('');
    try {
      await action();
    } catch (error) {
      setStatus(String(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const review = async () => {
    const diagnostics = include ? await nativeTask<Counts>('app_diagnostics') : undefined;
    setPreview({
      id: crypto.randomUUID(),
      kind,
      message: message.trim(),
      ...(diagnostics
        ? {
            diagnostics: {
              attempts: diagnostics.attempts,
              reviewed: diagnostics.reviewed,
              failed: diagnostics.failed,
              historySaveFailures: diagnostics.historySaveFailures,
            },
          }
        : {}),
    });
  };
  const send = async () => {
    if (!preview) return;
    await nativeTask('app_submit_feedback', { request: preview });
    void useFeedbackStore.getState().request({ action: 'completed' });
    onSubmitted?.();
    setPreview(null);
    setMessage('');
    setStatus(
      'Submitted. Your report is in the private inbox; an email notification will also be queued for the maintainer.',
    );
  };
  return (
    <section className="space-y-3" aria-label="Send feedback">
      <h3 className="text-base font-medium">
        {invited
          ? 'What’s useful, and what could feel better?'
          : 'Send a bug, feature request, or idea'}
      </h3>
      <p className="settings-row-description">
        Your message goes to Jackalope’s private dashboard and contact@jackalope.dev. App version,
        installed channel, and operating system are included. Leave out secrets and personal
        details. This is separate from usage sharing; we cannot reply unless you choose to include
        contact details.
      </p>
      {!settings?.configured && (
        <p className="settings-disclosure-box">
          Sending is unavailable in this build. You can still prepare and copy a local support
          report below.
        </p>
      )}
      {preview ? (
        <>
          <p className="text-sm font-medium">Review before sending · {preview.kind}</p>
          <p className="text-sm whitespace-pre-wrap break-words">{preview.message}</p>
          {preview.diagnostics && (
            <pre className="task-output">{JSON.stringify(preview.diagnostics, null, 2)}</pre>
          )}
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy || !settings?.configured} onClick={() => void act(send)}>
              {busy ? 'Sending…' : 'Send to Jackalope'}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setStatus('');
              }}
            >
              Edit message
            </Button>
          </div>
        </>
      ) : (
        <>
          <label htmlFor="feedback-kind" className="block text-sm font-medium">
            Type
          </label>
          <Select
            id="feedback-kind"
            className="settings-input"
            disabled={busy}
            value={kind}
            onValueChange={(value) => setKind(value as Report['kind'])}
          >
            <SelectItem value="bug">Bug report</SelectItem>
            <SelectItem value="feature">Feature request</SelectItem>
            <SelectItem value="idea">Idea</SelectItem>
          </Select>
          <label htmlFor="feedback-message" className="block text-sm font-medium">
            What would you like us to know?
          </label>
          <textarea
            ref={messageInput}
            id="feedback-message"
            className="settings-textarea"
            rows={5}
            maxLength={8000}
            value={message}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              invited
                ? 'Tell us what helped, what got in your way, or what you’d change.'
                : 'For a bug, include what you expected, what happened, and the steps to reproduce it.'
            }
          />
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">Include task outcome counts (preview before sending)</span>
            <Switch
              label="Include task outcome counts"
              checked={include}
              onCheckedChange={setInclude}
              disabled={busy}
            />
          </div>
          <Button
            variant="outline"
            disabled={busy || !isTauriEnvironment() || !settings?.configured || !message.trim()}
            onClick={() => void act(review)}
          >
            Review submission
          </Button>
        </>
      )}
      {status && (
        <p role="status" className="text-sm break-words">
          {status}
        </p>
      )}
    </section>
  );
}
