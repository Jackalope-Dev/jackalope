import { Ticket, X } from 'lucide-react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useReferralStore } from '../../stores/referralStore';
import { useSettingsStore } from '../../stores/settingsStore';
export function InvitationsButton({
  onClick,
  onDismiss,
  compact = false,
}: {
  onClick: () => void;
  onDismiss?: () => void;
  /** A plain status-bar entry without the dismiss control. */
  compact?: boolean;
}) {
  const { referrals, load } = useReferralStore(
    useShallow((s) => ({ referrals: s.referrals, load: s.load })),
  );
  const dismissed = !useSettingsStore((state) => state.showTrialPassesInToolbar);
  // The compact status-bar entry stays available after the larger chip was dismissed.
  const visible = compact || !dismissed;
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
  if (compact)
    return (
      <button
        type="button"
        onClick={onClick}
        title="Share trial passes"
        aria-label="Trial passes"
        className="statusbar-invitations"
      >
        <Ticket size={15} aria-hidden="true" />
        <span className="statusbar-label">Trial passes</span>
        {referrals ? ` ${referrals.remaining}/${referrals.limit}` : ''}
      </button>
    );
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
          onDismiss?.();
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
