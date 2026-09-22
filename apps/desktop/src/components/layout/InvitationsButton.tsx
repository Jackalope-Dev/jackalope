import { Ticket, X } from 'lucide-react';
import { useEffect } from 'react';
import { useReferralStore } from '../../stores/referralStore';
import { useSettingsStore } from '../../stores/settingsStore';
export function InvitationsButton({
  onClick,
  onDismiss,
}: {
  onClick: () => void;
  onDismiss: () => void;
}) {
  const { referrals, load } = useReferralStore();
  const visible = useSettingsStore((state) => state.showTrialPassesInToolbar);
  useEffect(() => {
    if (!visible) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = setInterval(refresh, 60_000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load, visible]);
  if (!visible) return null;
  return (
    <div className="workspace-invitations">
      <button
        type="button"
        className="invitation-action"
        aria-label="Trial passes"
        title="Trial passes"
        onClick={onClick}
      >
        <Ticket size={17} aria-hidden="true" />
        <span>Trial passes</span>
        {referrals && (
          <span className="invitation-count">
            {referrals.remaining}/{referrals.limit}
          </span>
        )}
      </button>
      <button
        type="button"
        className="quiet-icon"
        aria-label="Dismiss trial passes"
        title="Dismiss trial passes"
        onClick={() => {
          useSettingsStore.getState().updateSettings({ showTrialPassesInToolbar: false });
          onDismiss();
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
