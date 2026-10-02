import { ChevronRight, Info } from 'lucide-react';
import type { ReactNode } from 'react';

/** A quiet, full-width link to more of something: info icon, label, arrow. */
export function NoticeRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="notice-row" onClick={onClick}>
      <Info size={16} aria-hidden="true" />
      <span className="notice-row-label">{children}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}
