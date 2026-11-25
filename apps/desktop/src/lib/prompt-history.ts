/**
 * Recalling earlier prompts in a composer with ArrowUp and ArrowDown. Browsing works
 * like a shell: the draft becomes the last slot, edits to a recalled prompt stay with
 * that slot while browsing, and stepping down past the newest prompt restores the draft,
 * so nothing typed is lost.
 */
export interface HistoryBrowse {
  /** The slot shown: earlier prompts, oldest first, then the draft. */
  slots: string[];
  index: number;
}

const LIMIT = 100;

/** Prompts to browse, oldest first, without blanks or immediate repeats. */
export function historyEntries(prompts: readonly string[]) {
  const entries: string[] = [];
  for (const prompt of prompts) {
    const value = prompt.trim();
    if (value && entries.at(-1) !== value) entries.push(value);
  }
  return entries.slice(-LIMIT);
}

/** Whether the caret sits on the field's first (`up`) or last (`down`) line with nothing selected. */
export function caretAtEdge(
  text: string,
  start: number,
  end: number,
  direction: 'up' | 'down',
): boolean {
  if (start !== end) return false;
  return direction === 'up'
    ? !text.slice(0, start).includes('\n')
    : !text.slice(end).includes('\n');
}

/**
 * The next browse state and the text to show, or `null` when the key should keep its
 * usual caret movement.
 */
export function stepHistory(
  entries: readonly string[],
  browse: HistoryBrowse | null,
  current: string,
  direction: 'up' | 'down',
): { browse: HistoryBrowse | null; text: string } | null {
  if (!browse) {
    if (direction === 'down' || !entries.length) return null;
    const slots = [...entries, current];
    const index = entries.length - 1;
    return { browse: { slots, index }, text: slots[index] };
  }
  const slots = browse.slots.slice();
  slots[browse.index] = current;
  const index = browse.index + (direction === 'up' ? -1 : 1);
  if (index < 0) return { browse: { slots, index: 0 }, text: slots[0] };
  if (index >= slots.length - 1) return { browse: null, text: slots[slots.length - 1] };
  return { browse: { slots, index }, text: slots[index] };
}

const storageKey = (scope: string) => `jackalope-prompt-history:${scope}`;

/** Prompts sent from a composer that has no saved record of them, such as new work. */
export function storedPrompts(scope: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(scope)) ?? '[]');
    return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberPrompt(scope: string, prompt: string) {
  const value = prompt.trim();
  if (!value) return;
  try {
    const next = historyEntries([...storedPrompts(scope).filter((item) => item !== value), value]);
    localStorage.setItem(storageKey(scope), JSON.stringify(next.slice(-50)));
  } catch {
    // History is a convenience; a full or blocked store only loses recall.
  }
}
