import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The one way Jackalope talks: a bubble above the mascot with its tail pointing
 * at it. `side` is the direction the bubble extends from the mascot, so a mascot
 * at the right edge speaks to its upper left and one at the left edge to its
 * upper right. Render it inside the mascot's positioned wrapper.
 */
export function MascotSpeech({
  children,
  onDismiss,
  dismissLabel = 'Dismiss message',
  side = 'left',
  motion = true,
}: {
  children: ReactNode;
  onDismiss: () => void;
  dismissLabel?: string;
  side?: 'left' | 'right';
  motion?: boolean;
}) {
  return (
    <div className="mascot-speech" data-side={side} data-motion={motion} role="status">
      <span className="mascot-speech-text">{children}</span>
      <button
        type="button"
        className="mascot-bubble-close"
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
