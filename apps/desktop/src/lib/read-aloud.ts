import { useEffect, useState, useSyncExternalStore } from 'react';
import { bestVoice, speakableText, utterances } from './speech-text';

/**
 * Reading replies aloud with the system's speech synthesis. Nothing leaves this computer.
 * One reading plays at a time; starting another or stopping ends the current one.
 */

const VOICE_KEY = 'jackalope.read-aloud.voice';
export const AUTOMATIC_VOICE = 'auto';

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Voices load asynchronously in every engine; this follows the list as it arrives. */
export function useSpeechVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    speechSupported() ? window.speechSynthesis.getVoices() : [],
  );
  useEffect(() => {
    if (!speechSupported()) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

export function savedVoice() {
  try {
    return localStorage.getItem(VOICE_KEY) || AUTOMATIC_VOICE;
  } catch {
    return AUTOMATIC_VOICE;
  }
}

export function saveVoice(uri: string) {
  try {
    if (uri === AUTOMATIC_VOICE) localStorage.removeItem(VOICE_KEY);
    else localStorage.setItem(VOICE_KEY, uri);
  } catch {}
}

function chosenVoice() {
  const voices = window.speechSynthesis.getVoices();
  const saved = savedVoice();
  return (
    (saved !== AUTOMATIC_VOICE && voices.find((voice) => voice.voiceURI === saved)) ||
    bestVoice(voices)
  );
}

let current: symbol | null = null;
const listeners = new Set<() => void>();
function setCurrent(next: symbol | null) {
  current = next;
  for (const listener of listeners) listener();
}

/** Whether `id` is the reading that is playing now. */
export function useReading(id: symbol) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current === id,
  );
}

export function stopReading(id?: symbol) {
  if (id && current !== id) return;
  // Cleared before cancelling: some engines fire the interrupted utterance's events inside
  // cancel(), and they must not see this reading as still playing.
  setCurrent(null);
  if (speechSupported()) window.speechSynthesis.cancel();
}

/** Reads Markdown aloud as `id`, replacing whatever was playing. */
export function readAloud(id: symbol, markdown: string, voice = chosenVoice()) {
  if (!speechSupported()) return;
  stopReading();
  // Local voices read long passages without cutting off, so fewer, longer utterances
  // leave fewer pauses; network voices stop after a few hundred characters.
  const parts = utterances(speakableText(markdown), voice?.localService === false ? 220 : 900);
  if (!parts.length) return;
  setCurrent(id);
  const synth = window.speechSynthesis;
  parts.forEach((part, index) => {
    const utterance = new SpeechSynthesisUtterance(part);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.onend = () => {
      if (current === id && index === parts.length - 1) setCurrent(null);
    };
    // A failed utterance ends the reading rather than leaving it "on".
    utterance.onerror = () => {
      if (current === id) setCurrent(null);
    };
    synth.speak(utterance);
  });
}
