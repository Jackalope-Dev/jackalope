import type { KeyboardEvent } from 'react';

const ITEMS = 'button:not(:disabled), input:not(:disabled)';

/** The selected option in `container`, else its first one. */
export function pickerStart(container: Element | null | undefined): HTMLElement | null {
  return (
    container?.querySelector<HTMLElement>('[aria-pressed="true"], input:checked:not(:disabled)') ??
    container?.querySelector<HTMLElement>(ITEMS) ??
    null
  );
}

/**
 * Moves focus among the options in `container` with ↑, ↓, Home and End, as a menu does;
 * true when the key was used. Enter and Space then choose the focused option.
 */
export function movePickerFocus(event: KeyboardEvent, container: Element | null): boolean {
  if (!container || event.altKey || event.ctrlKey || event.metaKey) return false;
  const items = [...container.querySelectorAll<HTMLElement>(ITEMS)];
  if (!items.length) return false;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'ArrowDown'
      ? (index + 1) % items.length
      : event.key === 'ArrowUp'
        ? (index - 1 + items.length) % items.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : -1;
  if (next < 0) return false;
  event.preventDefault();
  items[next].focus();
  return true;
}
