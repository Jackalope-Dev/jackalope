import { type RefObject, useLayoutEffect } from 'react';

/** Matches settings.css: the grid's row unit and the gap left under each card. */
const ROW = 4;
const GAP = 16;

/**
 * Packs tiled settings cards (`data-settings-tile`) into two columns without gaps: each
 * card in a tiled section spans as many small grid rows as its height needs, so the next
 * card starts right under it. Narrow panes use one column and ignore the spans.
 */
export function useSettingsMasonry(content: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = content.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const measure = (card: Element) => {
      const height = card.getBoundingClientRect().height;
      (card as HTMLElement).style.setProperty(
        '--settings-span',
        String(Math.max(1, Math.ceil((height + GAP) / ROW))),
      );
    };
    const sizes = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.target);
    });
    const watch = () => {
      sizes.disconnect();
      for (const section of root.querySelectorAll('.settings-section')) {
        if (!section.querySelector(':scope > [data-settings-tile]')) continue;
        for (const card of section.children) {
          measure(card);
          sizes.observe(card);
        }
      }
    };
    watch();
    // Categories and their cards mount and unmount as the person moves through Settings.
    const changes = new MutationObserver(watch);
    changes.observe(root, { childList: true, subtree: true });
    return () => {
      changes.disconnect();
      sizes.disconnect();
    };
  }, [content]);
}
