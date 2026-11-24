/** Pasted text of at least this many UTF-8 bytes becomes a text-file attachment. */
const LARGE_PASTE_BYTES = 32 * 1024;

/**
 * Whether pasted text should be attached as a file rather than typed into the draft:
 * it is large, or it would not fit in the composer's remaining room.
 */
export function attachesPaste(pasted: string, room = Number.POSITIVE_INFINITY) {
  if (!pasted.trim()) return false;
  if ([...pasted].length > room) return true;
  return new TextEncoder().encode(pasted).length >= LARGE_PASTE_BYTES;
}

/** The chip label for a pasted text attachment, counted in characters. */
export function pastedTextLabel(pasted: string) {
  const characters = [...pasted].length;
  const lines = pasted.split(/\r?\n/).length;
  return `Pasted text · ${characters.toLocaleString('en-US')} characters, ${lines.toLocaleString('en-US')} ${lines === 1 ? 'line' : 'lines'}`;
}

/**
 * Undoing a pasted-text attachment: the pasted text goes back where its attachment
 * line is, or at the end when the line was removed.
 */
export function restorePaste(draft: string, reference: string, pasted: string) {
  const lines = draft.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === reference);
  if (index < 0) return draft.trim() ? `${draft.replace(/\s+$/, '')}\n\n${pasted}` : pasted;
  lines.splice(index, 1, pasted);
  return lines.join('\n');
}
