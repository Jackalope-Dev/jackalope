import { flushSync } from 'react-dom';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

/**
 * Moves between screens. Where the WebView supports view transitions and motion is
 * allowed, the tapped element grows into the next screen (which carries the same
 * `view-transition-name` in CSS); otherwise the screen simply changes. The update itself
 * never waits on the animation.
 */
export function moveTo(update: () => void, from?: HTMLElement | null) {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  if (from) from.style.viewTransitionName = 'mobile-focus';
  doc.startViewTransition(() => {
    if (from) from.style.viewTransitionName = '';
    flushSync(update);
  });
}
