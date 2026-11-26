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

// Novelty voices, and the older Eloquence ones whose formant synthesis sounds robotic.
const NOVELTY =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Fred|Good News|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/;
// Long-standing natural-sounding system voices, for when no premium voice is installed.
const NATURAL =
  /^(Samantha|Ava|Zoe|Allison|Susan|Evan|Nathan|Tom|Alex|Aaron|Nicky|Daniel|Serena|Karen|Moira|Tessa|Lee|Catherine|Fiona)\b/;

export function isUsableVoice(voice: SpeechSynthesisVoice) {
  return !NOVELTY.test(voice.name);
}

/** Higher is better: the person's language first, then premium and neural voices. */
function voiceScore(voice: SpeechSynthesisVoice, language: string) {
  if (!isUsableVoice(voice)) return -100;
  const lang = voice.lang.replace('_', '-').toLowerCase();
  const wanted = language.toLowerCase();
  let score = 0;
  if (lang === wanted) score += 100;
  else if (lang.split('-')[0] === wanted.split('-')[0]) score += 80;
  if (/premium/i.test(voice.name)) score += 30;
  else if (/enhanced/i.test(voice.name)) score += 20;
  if (/natural|neural|online/i.test(voice.name)) score += 25;
  if (/^google/i.test(voice.name)) score += 8;
  if (NATURAL.test(voice.name)) score += 10;
  if (voice.localService) score += 2;
  if (voice.default) score += 1;
  return score;
}

export function bestVoice(
  voices: SpeechSynthesisVoice[],
  language = navigator.language || 'en-US',
) {
  let best: SpeechSynthesisVoice | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const voice of voices) {
    const score = voiceScore(voice, language);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}
