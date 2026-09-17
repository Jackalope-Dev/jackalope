import { Ticket } from 'lucide-react';
import { useEffect } from 'react';
import { useReferralStore } from '../../stores/referralStore';
export function InvitationsButton({ onClick }: { onClick: () => void }) {
  const { referrals, load } = useReferralStore();
  useEffect(() => {
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
  }, [load]);
  return (
    <button type="button" className="workspace-nav-item workspace-invitations" onClick={onClick}>
      <Ticket size={17} aria-hidden="true" />
      {referrals && (
        <span className="invitation-count">
          {referrals.remaining}/{referrals.limit}
        </span>
      )}
      <span>Trial passes</span>
    </button>
  );
}
