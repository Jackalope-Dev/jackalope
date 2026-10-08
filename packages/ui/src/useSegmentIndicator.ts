import { type Ref, type RefCallback, useCallback, useLayoutEffect, useRef } from 'react';

const ACTIVE = ':scope > :is([aria-pressed="true"], [aria-current="page"], [data-state="active"])';

/**
 * Places a sliding highlight under a segmented track's selected item. The track gets
 * `data-indicator` once measured (so the item's own selected fill can hand over to the
 * highlight) and `data-indicator="ready"` a frame later, which enables the slide; the first
 * placement therefore never animates in from the left.
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
    function place() {
      if (!track) return;
      const active = track.querySelector<HTMLElement>(ACTIVE);
      if (!active) {
        track.removeAttribute('data-indicator');
        return;
      }
      track.style.setProperty('--segment-x', `${active.offsetLeft}px`);
      track.style.setProperty('--segment-y', `${active.offsetTop}px`);
      track.style.setProperty('--segment-w', `${active.offsetWidth}px`);
      track.style.setProperty('--segment-h', `${active.offsetHeight}px`);
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
