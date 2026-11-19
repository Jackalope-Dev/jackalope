import { AgentCharacter } from '@jackalope/brand/agent-character';
import { describeError } from '@jackalope/contracts/errors';
import { emit, listen } from '@tauri-apps/api/event';
import { ArrowUp, ChevronDown, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { sessionCommand } from '../../lib/live-session';
import {
  ATTACH_ASK_EVENT,
  ATTACH_ASK_RESULT_EVENT,
  type AttachAsk,
  type AttachAskResult,
  BADGE_PULSE_EVENT,
  type BadgeState,
  badgeState,
  detachFromBadge,
  openFromBadge,
  overlayReady,
  resizeBadge,
} from '../../lib/window-attach';
import { windowKind } from '../../lib/window-kind';
import { useWindowTheme } from '../../window-bootstrap';
import './attach-badge.css';

/** How long the new-work composer gets to pick up a question before it waits in the draft. */
const ASK_TIMEOUT = 2500;

type Sent = { kind: 'sent' | 'drafted'; text: string } | null;

/**
 * Rides on an attached window's top edge until the agent takes the window: says that it
 * is attached and whether the agent may see or also control it, detaches with ×, and
 * opens into a small box for asking about the window. Asking sends the message into the
 * conversation; it grants nothing.
 */
export function AttachBadge() {
  useWindowTheme(undefined);
  const [state, setState] = useState<BadgeState | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  /** Bumped when Jackalope asks where the window is, to replay the bounce. */
  const [bounce, setBounce] = useState(0);
  useEffect(() => {
    const kind = windowKind();
    const label = kind.kind === 'badge' ? kind.label : '';
    const stop = listen<string>(BADGE_PULSE_EVENT, (event) => {
      if (event.payload === label) setBounce((value) => value + 1);
    });
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => void overlayReady().catch(() => undefined));
    });
    const read = () =>
      void badgeState()
        .then(setState)
        .catch(() => undefined);
    read();
    // The key changes when Send turns the draft into a conversation.
    const timer = setInterval(read, 4000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    setError('');
    void resizeBadge(next).catch(() => undefined);
    if (next) requestAnimationFrame(() => input.current?.focus());
  };

  const askDraft = (current: BadgeState, question: string) =>
    new Promise<AttachAskResult | null>((resolve) => {
      const requestId = crypto.randomUUID();
      let stop: (() => void) | undefined;
      const timer = setTimeout(() => {
        stop?.();
        resolve(null);
      }, ASK_TIMEOUT);
      void listen<AttachAskResult>(ATTACH_ASK_RESULT_EVENT, (event) => {
        if (event.payload.requestId !== requestId) return;
        clearTimeout(timer);
        stop?.();
        resolve(event.payload);
      }).then((unlisten) => {
        stop = unlisten;
        void emit(ATTACH_ASK_EVENT, {
          requestId,
          key: current.key,
          text: question,
        } satisfies AttachAsk);
      });
    });

  const send = async () => {
    const question = text.trim();
    if (!question || busy || !state) return;
    setBusy(true);
    setError('');
    try {
      const current = await badgeState();
      if (current.draft) {
        const result = await askDraft(current, question);
        if (result?.error) throw new Error(result.error);
        if (!result) {
          // Nobody had the composer open: the question waits in the project's draft.
          const project = current.key.slice('draft:'.length);
          const key = `jackalope-live-start:${project}`;
          const draft = localStorage.getItem(key)?.trim();
          localStorage.setItem(key, draft ? `${draft}\n\n${question}` : question);
          setSent({ kind: 'drafted', text: question });
        } else setSent({ kind: 'sent', text: question });
      } else {
        await sessionCommand('send', {
          id: current.key,
          messageId: crypto.randomUUID(),
          text: question,
        });
        setSent({ kind: 'sent', text: question });
      }
      setText('');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  // Escape closes the box from anywhere in it, not only the text field.
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') toggleRef.current(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  if (!state) return null;
  const mode = state.control ? 'can control' : 'see only';
  return (
    <div className="attach-badge" data-open={open || undefined}>
      <div className="attach-badge-dock">
        <span
          key={bounce}
          className="attach-badge-agent"
          data-bounce={bounce > 0 || undefined}
          aria-hidden="true"
        >
          <AgentCharacter provider={state.provider || 'auto'} state="idle" />
        </span>
        <div className="attach-badge-bar">
          <button
            type="button"
            className="attach-badge-main"
            aria-expanded={open}
            aria-label={`${state.agent} is attached to this window, ${mode}. ${open ? 'Close' : 'Ask about this window'}`}
            onClick={() => toggle(!open)}
          >
            <span className="attach-badge-text">
              <strong>Attached</strong> · {mode}
            </span>
            <ChevronDown size={14} aria-hidden="true" className="attach-badge-chevron" />
          </button>
          <button
            type="button"
            className="attach-badge-icon"
            aria-label="Detach this window"
            title="Detach"
            onClick={() => void detachFromBadge()}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {open && (
        <div className="attach-badge-ask">
          <textarea
            ref={input}
            rows={2}
            maxLength={4000}
            value={text}
            placeholder={`Ask ${state.agent} about this window…`}
            aria-label={`Ask ${state.agent} about this window`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            readOnly={busy}
          />
          <div className="attach-badge-footer">
            <span className="attach-badge-status" role="status">
              {error ? (
                <span className="attach-badge-error">{error}</span>
              ) : sent?.kind === 'sent' ? (
                'Sent to Jackalope.'
              ) : sent?.kind === 'drafted' ? (
                'Added to your draft in Jackalope.'
              ) : (
                `Waits ${state.minutesLeft} more min`
              )}
            </span>
            <button
              type="button"
              className="attach-badge-link"
              onClick={() => void openFromBadge()}
            >
              Open in Jackalope
            </button>
            <button
              type="button"
              className="attach-badge-send"
              aria-label="Send"
              disabled={busy || !text.trim()}
              onClick={() => void send()}
            >
              <ArrowUp size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
