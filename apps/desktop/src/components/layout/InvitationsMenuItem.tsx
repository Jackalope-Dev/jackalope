import { DropdownMenu as Menu } from '@jackalope/ui';
import { Ticket } from 'lucide-react';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useReferralStore } from '../../stores/referralStore';

/** Remaining trial passes, refreshed whenever the menu holding it opens. */
export function InvitationsMenuItem({ onSelect }: { onSelect: () => void }) {
  const { referrals, load } = useReferralStore(
    useShallow((s) => ({ referrals: s.referrals, load: s.load })),
  );
  useEffect(() => {
    void load(false);
  }, [load]);
  if (!referrals || referrals.openSignup) return null;
  return (
    <Menu.Item className="workspace-menu-item" onSelect={onSelect}>
      <Ticket size={16} aria-hidden="true" />
      <span className="flex-1">Trial passes</span>
      <span className="tabular-nums text-[var(--color-text-muted)]">
        {referrals.remaining}/{referrals.limit}
      </span>
    </Menu.Item>
  );
}
