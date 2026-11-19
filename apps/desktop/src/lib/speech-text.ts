/**
 * Turns an agent's Markdown reply into text worth hearing: prose is kept, code, tables
 * and link addresses are named or dropped, so a diff is not read out as punctuation.
 */
export function speakableText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?(?:```|$)/g, '\nCode block.\n')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, '$1.')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The most one utterance holds; longer ones are cut off by some system voices. */
const UTTERANCE_MAX = 220;

/** Splits speakable text into short utterances at sentence and clause boundaries. */
export function utterances(text: string, max = UTTERANCE_MAX) {
  const parts: string[] = [];
  for (const line of text.split('\n')) {
    let current = '';
    for (const sentence of line.match(/[^.!?]+[.!?]*\s*/g) ?? []) {
      const pieces =
        sentence.length > max ? (sentence.match(/[^,;:]+[,;:]?\s*/g) ?? [sentence]) : [sentence];
      for (let piece of pieces) {
        // A single run with no punctuation is cut at a space.
        while (piece.length > max) {
          const cut = piece.lastIndexOf(' ', max);
          const at = cut > 0 ? cut : max;
          if (current.trim()) parts.push(current.trim());
          current = '';
          parts.push(piece.slice(0, at).trim());
          piece = piece.slice(at);
        }
        if (current.length + piece.length > max && current.trim()) {
          parts.push(current.trim());
          current = '';
        }
        current += piece;
      }
    }
    if (current.trim()) parts.push(current.trim());
  }
  return parts.filter(Boolean);
}
