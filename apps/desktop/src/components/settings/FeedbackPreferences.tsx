import { useEffect } from 'react';
import { useFeedbackStore } from '../../stores/feedbackStore';
import { Button } from '../ui/button';
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
      <div className="flex items-center justify-between gap-4">
        <span>Email me once after I’ve tried Jackalope</span>
        <Switch
          label="Email me once after I’ve tried Jackalope"
          checked={view?.enabled ?? false}
          disabled={busy || !view || view.completed}
          onCheckedChange={(enabled) =>
            void request({
              action: 'preferences',
              enabled,
              promptsEnabled: view?.promptsEnabled ?? true,
            })
          }
        />
      </div>
      <p className="settings-row-description">
        Email follow-up is off until you choose it. Enabling it links active days and up to two
        opened task results to your Jackalope account, along with invitation and response status. No
        task contents or project details are shared. Anonymous usage sharing stays separate.
      </p>
      <p className="settings-row-description">
        Invitation preferences and responses sync with your account to avoid repeat requests across
        desktops. At most two in-app invitations and one email, at least seven days apart. Later
        pauses requests for 14 days. Sending feedback ends this round of invitations.
      </p>
      {view?.completed && (
        <p role="status" className="settings-row-description">
          Thanks for sharing your thoughts. This round of invitations is complete.
        </p>
      )}
      {error && (
        <p role="alert" className="settings-row-description">
          {error}{' '}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void request({ action: 'status' })}
          >
            Retry
          </Button>
        </p>
      )}
    </section>
  );
}
