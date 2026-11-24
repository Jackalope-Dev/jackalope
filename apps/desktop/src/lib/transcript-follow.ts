/** A scroll container's position and extent at one moment. */
export interface ScrollSample {
  top: number;
  height: number;
  client: number;
}

/** How close to the end a downward scroll has to come to start following again. */
const END_SLACK = 24;

export const distanceFromEnd = (sample: ScrollSample) =>
  Math.max(0, sample.height - sample.top - sample.client);

export const sampleScroll = (node: HTMLElement): ScrollSample => ({
  top: node.scrollTop,
  height: node.scrollHeight,
  client: node.clientHeight,
});

/**
 * Whether a transcript keeps following new content after a scroll from `previous` to
 * `next`. Reaching the end follows; moving up while the layout stayed the same is the
 * person reading back, so it stops. Moves caused by content growing, measuring or
 * shrinking keep the current choice.
 */
export function followAfterScroll(
  following: boolean,
  previous: ScrollSample | null,
  next: ScrollSample,
) {
  const distance = distanceFromEnd(next);
  if (distance <= 1) return true;
  if (!previous) return following;
  const sameLayout = next.height === previous.height && next.client === previous.client;
  if (next.top > previous.top && distance <= END_SLACK) return true;
  if (next.top < previous.top - 1 && sameLayout) return false;
  return following;
}

/** Scroll behavior for returning to the end: instant for long distances or reduced motion. */
export function jumpBehavior(distance: number, viewport: number, reducedMotion: boolean) {
  return reducedMotion || distance > viewport * 3 ? 'auto' : 'smooth';
}
