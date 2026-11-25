import { type Ref, type RefCallback, useCallback, useLayoutEffect, useRef } from 'react';

const ACTIVE = ':scope > :is([aria-pressed="true"], [aria-current="page"], [data-state="active"])';

/**
 * Places a sliding highlight under a segmented track's selected item. The track gets
 * `data-indicator` once measured (so the item's own selected fill can hand over to the
 * highlight) and `data-indicator="ready"` a frame later, which enables the slide; the first
 * placement therefore never animates in from the left.
 *
 * The highlight moves like a droplet: its edges are separate properties, so the stylesheet
 * can let the edge facing the travel lead and the other follow. `data-direction` says which
 * way it is heading, and `data-moving` alternates between two names on each change of
 * selection so the squash animation restarts.
 */
export function useSegmentIndicator<T extends HTMLElement>(forwarded?: Ref<T>): RefCallback<T> {
  const node = useRef<T | null>(null);
  const setRef = useCallback(
    (element: T | null) => {
      node.current = element;
      if (typeof forwarded === 'function') forwarded(element);
      else if (forwarded) (forwarded as { current: T | null }).current = element;
    },
    [forwarded],
  );
  useLayoutEffect(() => {
    const track = node.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const resize = new ResizeObserver(() => place());
    let frame = 0;
    let selected: HTMLElement | null = null;
    let start = 0;
    function place() {
      if (!track) return;
      const active = track.querySelector<HTMLElement>(ACTIVE);
      const indicator = track.querySelector<HTMLElement>(':scope > .ui-segmented-indicator');
      if (!active || !indicator) {
        track.removeAttribute('data-indicator');
        selected = null;
        return;
      }
      const left = active.offsetLeft;
      if (left !== start) track.dataset.direction = left > start ? 'forward' : 'back';
      if (selected && active !== selected && track.dataset.indicator === 'ready') {
        track.dataset.moving = track.dataset.moving === 'a' ? 'b' : 'a';
      }
      selected = active;
      start = left;
      indicator.style.setProperty('--segment-start', `${left}px`);
      indicator.style.setProperty('--segment-end', `${left + active.offsetWidth}px`);
      indicator.style.setProperty('--segment-y', `${active.offsetTop}px`);
      indicator.style.setProperty('--segment-h', `${active.offsetHeight}px`);
      if (!track.hasAttribute('data-indicator')) {
        track.setAttribute('data-indicator', '');
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => track.setAttribute('data-indicator', 'ready'));
      }
      for (const child of track.children) resize.observe(child);
    }
    place();
    const mutations = new MutationObserver(place);
    mutations.observe(track, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed', 'aria-current', 'data-state'],
    });
    resize.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
    };
  }, []);
  return setRef;
}
