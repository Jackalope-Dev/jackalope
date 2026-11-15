import { Button } from '@jackalope/ui';
import { Square, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { speakableText, utterances } from '../../lib/speech-text';

/** The reply being read, so starting another stops it and every button shows the truth. */
let speaking: symbol | null = null;
const listeners = new Set<() => void>();
function setSpeaking(next: symbol | null) {
  speaking = next;
  for (const listener of listeners) listener();
}

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Reads a reply aloud with the system voice, only when asked. Nothing leaves this
 * computer, and code and tables are named rather than read out.
 */
export function ReadAloudButton({ text, className }: { text: string; className?: string }) {
  const [id] = useState(() => Symbol('reply'));
  const [active, setActive] = useState(false);
  useEffect(() => {
    const listener = () => setActive(speaking === id);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      // Leaving the conversation stops its reply.
      if (speaking === id) {
        window.speechSynthesis.cancel();
        setSpeaking(null);
      }
    };
  }, [id]);
  if (!supported()) return null;
  const toggle = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speaking === id) return setSpeaking(null);
    const parts = utterances(speakableText(text));
    if (!parts.length) return;
    setSpeaking(id);
    parts.forEach((part, index) => {
      const utterance = new SpeechSynthesisUtterance(part);
      const finish = () => {
        if (speaking === id && index === parts.length - 1) setSpeaking(null);
      };
      utterance.onend = finish;
      // An interrupted or failed utterance ends the reading rather than leaving it "on".
      utterance.onerror = () => speaking === id && setSpeaking(null);
      synth.speak(utterance);
    });
  };
  return (
    <Button variant="ghost" size="sm" className={className} aria-pressed={active} onClick={toggle}>
      {active ? <Square size={12} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
      {active ? 'Stop' : 'Read aloud'}
    </Button>
  );
}
