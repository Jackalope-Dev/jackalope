import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useFeedbackStore } from '../../stores/feedbackStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';
import { Switch } from '../ui/Switch';
import { Setting, SettingBody, SettingGroup } from './Setting';

export function FeedbackPreferences() {
  const { view, busy, error, request } = useFeedbackStore(
    useShallow((s) => ({ view: s.view, busy: s.busy, error: s.error, request: s.request })),
  );
  useEffect(() => {
    void request({ action: 'status' });
  }, [request]);
  return (
    <SettingGroup
      aria-label="Feedback invitations"
      title="Help shape Jackalope"
      description="Occasional, quiet invitations after you’ve had time to use the app. You can always send feedback in Updates & support."
    >
      <Setting
        title="Allow in-app feedback invitations"
        description="At most two in-app invitations, synced across desktops. Later pauses them for 14 days; sending feedback ends this round."
      >
        <Switch
          label="Allow in-app feedback invitations"
          checked={view?.promptsEnabled ?? true}
          disabled={busy || !view || view.completed}
          onCheckedChange={(promptsEnabled) =>
            void request({ action: 'preferences', enabled: view?.enabled ?? false, promptsEnabled })
          }
        />
      </Setting>
      {(view?.completed || error) && (
        <SettingBody>
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
        </SettingBody>
      )}
    </SettingGroup>
  );
}
