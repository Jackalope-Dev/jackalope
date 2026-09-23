import { useEffect } from 'react';
import { useFeedbackStore } from '../../stores/feedbackStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';

export function FeedbackPreferences() {
  const { view, busy, error, request } = useFeedbackStore();
  useEffect(() => {
    void request({ action: 'status' });
  }, [request]);
  return (
    <section className="space-y-3" aria-label="Feedback invitations">
      <h3 className="text-base font-medium">Help shape Jackalope</h3>
      <p className="settings-row-description">
        Occasional, quiet invitations after you’ve had time to use the app. You can always send
        feedback in Updates &amp; support.
      </p>
      <div className="flex items-center justify-between gap-4">
        <span>Allow in-app feedback invitations</span>
        <Switch
          label="Allow in-app feedback invitations"
          checked={view?.promptsEnabled ?? true}
          disabled={busy || !view || view.completed}
          onCheckedChange={(promptsEnabled) =>
            void request({ action: 'preferences', enabled: view?.enabled ?? false, promptsEnabled })
          }
        />
      </div>
      <p className="settings-row-description">
        At most two in-app invitations, synced across desktops. Later pauses them for 14 days;
        sending feedback ends this round.
      </p>
      {view?.completed && (
        <InlineNotice role="status">
          Thanks for sharing your thoughts. This round of invitations is complete.
        </InlineNotice>
      )}
      {error && (
        <InlineNotice tone="error">
          {error}{' '}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void request({ action: 'status' })}
          >
            Retry
          </Button>
        </InlineNotice>
      )}
    </section>
  );
}
