import { describeError } from '@jackalope/contracts/errors';
import {
  Button,
  Choice,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  InlineNotice,
  LinkButton,
  LoadingState,
  Tooltip,
} from '@jackalope/ui';
import { listen } from '@tauri-apps/api/event';
import { AppWindow, Eye, Globe, Link2, MousePointerClick, X } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { openExternalUrl } from '../../lib/native/env';
import {
  ATTACH_CHANGED_EVENT,
  ATTACH_HELP_URL,
  type AttachedWindow,
  type AttachSupport,
  type AttachTarget,
  attachedWindow,
  attachMessage,
  attachSite,
  attachSupport,
  attachWindows,
  clearAttached,
  confirmAttach,
  endGlob,
  GLOB_DROPPED_EVENT,
  GLOB_TARGET_EVENT,
  type GlobDropped,
  globLog,
  prepareGlob,
  revealAttached,
  startGlob,
} from '../../lib/window-attach';
import { GlobFigure } from './GlobFigure';
import { GlobMotion, prefersReducedMotion } from './glob-motion';
import './window-glob.css';

/** Pointer travel that counts as a drag rather than a click. */
const CLICK_SLOP = 6;
/** How far the agent stretches like taffy before it snaps free of its socket. */
const SNAP = 30;
/** Where the free agent's centre sits from the pointer: the overlay's lead plus its blob
 * centre (attach/overlay.rs LEAD and BLOB), so the hand-off at the window edge is seamless. */
const CARRY = 52;
/** How far the gooey neck reaches before it thins out and lets go. */
const NECK = 170;
/** How long the overlay's spring home plays before the agent pops back into its socket. */
const HOME_DELAY = 380;
/** Losing the pointer this close to the window edge means it left the window. */
const EDGE = 40;
const HINT_KEY = 'jackalope.glob-hint';
const HINT_TIMES = 3;

type Phase = 'idle' | 'pressed' | 'free' | 'out' | 'home';

const readHints = () => {
  try {
    return Number(localStorage.getItem(HINT_KEY) ?? 0) || 0;
  } catch {
    return HINT_TIMES;
  }
};
const writeHints = (value: number) => {
  try {
    localStorage.setItem(HINT_KEY, String(value));
  } catch {}
};

/**
 * The conversation's agent, which can be pulled out of Jackalope and dropped onto any
 * window to attach it, or clicked to pick a window from a list. It stretches out of its
 * socket on a gooey neck, snaps free, and hands over to a transparent overlay at the
 * window edge. Attaching stages one window: the agent's next desktop access request takes
 * it without asking again, and nothing is shared before that.
 */
export function WindowGlob({
  conversation,
  provider,
  agent,
  disabled,
  mascotRef,
  onAttached,
  onAttachedChange,
  refresh = 0,
  compact,
  note,
  children,
}: {
  /** The conversation id, or a `draft:` key before a conversation exists. */
  conversation: string;
  provider: string;
  agent: string;
  disabled?: boolean;
  mascotRef: RefObject<HTMLSpanElement | null>;
  /** Adds the attach note to the composer. */
  onAttached: (text: string) => Promise<void>;
  /** Told whenever the attached window changes, including detach. */
  onAttachedChange?: (window: AttachedWindow | null) => void;
  /** Changing it rereads the attached window, after the owner moved or cleared it. */
  refresh?: number;
  /** A small handle for a composer toolbar instead of the header-sized agent. */
  compact?: boolean;
  /** Shown in the attach dialog, such as which kinds of work receive the window. */
  note?: string;
  children: ReactNode;
}) {
  const [support, setSupport] = useState<AttachSupport>({ drag: false, pick: false, badge: false });
  const [phase, setPhaseState] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };
  const [hovered, setHovered] = useState<AttachTarget | null>(null);
  const [announce, setAnnounce] = useState('');
  const [dialog, setDialog] = useState<{ dropped: AttachTarget | null } | null>(null);
  const [attached, setAttachedState] = useState<AttachedWindow | null>(null);
  const [hint, setHint] = useState(false);
  /** Bumped when the agent lands back in its socket, to replay the pop. */
  const [landed, setLanded] = useState(0);
  const changed = useRef(onAttachedChange);
  changed.current = onAttachedChange;
  const wasAttached = useRef(false);
  const setAttached = (window: AttachedWindow | null) => {
    setAttachedState(window);
    changed.current?.(window);
  };
  // Detached: the agent comes home to its socket with a pop.
  useEffect(() => {
    if (wasAttached.current && !attached) setLanded((value) => value + 1);
    wasAttached.current = !!attached;
  }, [attached]);
  const handle = useRef<HTMLButtonElement>(null);
  const stretch = useRef<HTMLSpanElement>(null);
  const carrier = useRef<HTMLSpanElement>(null);
  const neck = useRef<SVGGElement>(null);
  const motion = useMemo(() => new GlobMotion(), []);
  const drag = useRef({ start: { x: 0, y: 0 }, socket: { x: 0, y: 0 }, radius: 18 });
  /** Where the free agent was last drawn, so a re-render never puts it elsewhere. */
  const carried = useRef({ x: 0, y: 0 });
  const prepared = useRef(false);
  const ending = useRef(false);
  const reduced = useMemo(prefersReducedMotion, []);

  useEffect(() => {
    let live = true;
    void attachSupport()
      .then((value) => {
        if (!live) return;
        setSupport(value);
        if (value.drag && readHints() < HINT_TIMES) {
          writeHints(readHints() + 1);
          setHint(true);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(timer);
  }, [hint]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh rereads after the owner moves or clears the window
  useEffect(() => {
    let live = true;
    void attachedWindow(conversation)
      .then((value) => {
        if (!live) return;
        setAttachedState(value);
        changed.current?.(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [conversation, refresh]);
  // A window detached from its badge on the desktop.
  useEffect(() => {
    if (!support.badge) return;
    const stop = listen<string>(ATTACH_CHANGED_EVENT, (event) => {
      if (event.payload !== conversation) return;
      void attachedWindow(conversation).then((value) => {
        setAttachedState(value);
        changed.current?.(value);
      });
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [conversation, support.badge]);

  const out = phase === 'out';
  // Native code ends the drag on the mouse release wherever it happens; the webview
  // rarely sees that release once the pointer is over another app.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handlers read live state through refs
  useEffect(() => {
    if (!out) return;
    const stop = listen<GlobDropped>(GLOB_DROPPED_EVENT, (event) => {
      if (phaseRef.current !== 'out') return;
      const { target, canceled } = event.payload;
      globLog(
        `app heard the drop: ${target ? `${target.app}` : canceled ? 'canceled' : 'nothing'}`,
      );
      setHovered(null);
      if (target) {
        land();
        setAnnounce(`Dropped on ${target.app}: ${target.title}`);
        setDialog({ dropped: target });
      } else {
        setPhase('home');
        setAnnounce(
          canceled ? 'Canceled.' : 'No window there. Drop the agent onto another app’s window.',
        );
        setTimeout(land, HOME_DELAY);
      }
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [out]);
  useEffect(() => {
    if (!out) return;
    const stop = listen<AttachTarget | null>(GLOB_TARGET_EVENT, (event) => {
      setHovered(event.payload);
      setAnnounce(
        event.payload ? `Over ${event.payload.app}: ${event.payload.title}` : 'Not over a window',
      );
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [out]);
  const active = phase !== 'idle';
  // biome-ignore lint/correctness/useExhaustiveDependencies: Escape reads the live phase through refs
  useEffect(() => {
    if (!active) return;
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (phaseRef.current === 'out') void finish(false);
      else if (phaseRef.current !== 'home') goHome();
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [active]);

  const prepare = () => {
    if (prepared.current || !support.drag) return;
    prepared.current = true;
    void prepareGlob().catch(() => {
      prepared.current = false;
    });
  };

  /** The agent lands back in its socket with a little pop. */
  const land = () => {
    setPhase('idle');
    setHovered(null);
    setLanded((value) => value + 1);
    if (stretch.current) stretch.current.style.transform = '';
  };

  /** Flies the free agent back into its socket, or lets the taffy spring back. */
  function goHome() {
    const { socket } = drag.current;
    if (phaseRef.current === 'pressed' || reduced) {
      if (stretch.current) {
        stretch.current.style.transition = `transform var(--motion-base) cubic-bezier(0.34, 1.56, 0.64, 1)`;
        stretch.current.style.transform = '';
      }
      drawNeck(socket, socket, 0);
      setPhase('idle');
      return;
    }
    setPhase('home');
    if (carrier.current) {
      carrier.current.style.transition = 'transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)';
      carrier.current.style.transform = `translate(${socket.x}px, ${socket.y}px) scale(0.5)`;
    }
    drawNeck(socket, socket, 0);
    setTimeout(land, 300);
  }

  /** Draws the gooey neck from the socket to the agent; it thins out with distance. */
  function drawNeck(from: { x: number; y: number }, to: { x: number; y: number }, reach: number) {
    const group = neck.current;
    if (!group) return;
    const radius = drag.current.radius;
    const left = Math.max(0, 1 - reach / NECK);
    const circles = group.children;
    for (let i = 0; i < circles.length; i++) {
      const t = i / (circles.length - 1);
      const circle = circles[i] as SVGCircleElement;
      circle.setAttribute('cx', (from.x + (to.x - from.x) * t).toFixed(1));
      circle.setAttribute('cy', (from.y + (to.y - from.y) * t).toFixed(1));
      // Thickest at both ends, thinnest in the middle, all fading as it stretches.
      // The socket end stays small so the agent still shows through it.
      const waist = 1 - Math.sin(t * Math.PI) * 0.55;
      const base = i === 0 ? radius * 0.55 : radius * waist;
      const end = i === circles.length - 1 ? radius * 0.9 : base * left;
      circle.setAttribute('r', Math.max(0, end).toFixed(1));
    }
  }

  /** Asks native code to end the drag; the outcome arrives as the dropped event. */
  async function finish(drop: boolean) {
    if (ending.current || phaseRef.current !== 'out') return;
    ending.current = true;
    try {
      await endGlob(drop);
    } catch (error) {
      globLog(`ending the drag failed: ${describeError(error)}`);
      land();
      setAnnounce(describeError(error));
    } finally {
      ending.current = false;
    }
  }

  function leave(why: string) {
    if (phaseRef.current === 'out') return;
    globLog(`left the window (${why}), handing over to the overlay`);
    setPhase('out');
    setAnnounce(`Dragging ${agent}. Drop it on any window, or press Escape to cancel.`);
    void startGlob(conversation, provider).catch((error) => {
      globLog(`starting the drag failed: ${describeError(error)}`);
      goHome();
      setAnnounce(describeError(error));
      setDialog({ dropped: null });
    });
  }
  /** The last pointer position the webview saw, to tell a lost pointer at the edge. */
  const lastPointer = useRef({ x: 0, y: 0 });

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0 || !support.drag || phaseRef.current !== 'idle') return;
    prepare();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      start: { x: event.clientX, y: event.clientY },
      socket: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      radius: Math.max(12, rect.width * 0.42),
    };
    if (stretch.current) stretch.current.style.transition = 'none';
    lastPointer.current = { x: event.clientX, y: event.clientY };
    globLog('picked up');
    setPhase('pressed');
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = phaseRef.current;
    if (current !== 'pressed' && current !== 'free') return;
    const { start, socket } = drag.current;
    const pointer = { x: event.clientX, y: event.clientY };
    lastPointer.current = pointer;
    const away =
      pointer.x < 0 ||
      pointer.y < 0 ||
      pointer.x >= window.innerWidth ||
      pointer.y >= window.innerHeight;
    if (current === 'pressed') {
      const dx = pointer.x - start.x;
      const dy = pointer.y - start.y;
      const length = Math.hypot(dx, dy);
      if (reduced) {
        if (length >= CLICK_SLOP) {
          setHint(false);
          writeHints(HINT_TIMES);
          leave('reduced motion');
        }
        return;
      }
      if (length < SNAP && !away) {
        // Taffy: the agent stretches toward the pointer, still stuck in its socket.
        const reach = Math.min(length, SNAP);
        const angle = Math.atan2(dy, dx);
        if (stretch.current)
          stretch.current.style.transform = `translate(${((dx / (length || 1)) * reach * 0.45).toFixed(1)}px, ${((dy / (length || 1)) * reach * 0.45).toFixed(1)}px) rotate(${angle}rad) scale(${(1 + reach / 70).toFixed(3)}, ${(1 - reach / 160).toFixed(3)}) rotate(${-angle}rad)`;
        drawNeck(socket, { x: socket.x + dx * 0.9, y: socket.y + dy * 0.9 }, reach);
        return;
      }
      // Snap: it pops free and the socket stays behind.
      globLog('snapped free of its socket');
      setHint(false);
      writeHints(HINT_TIMES);
      motion.reset();
      carried.current = { x: pointer.x + CARRY, y: pointer.y + CARRY };
      if (stretch.current) stretch.current.style.transform = '';
      setPhase('free');
    }
    const at = { x: pointer.x + CARRY, y: pointer.y + CARRY };
    carried.current = at;
    motion.push(at.x, at.y);
    if (carrier.current) {
      carrier.current.style.transition = 'none';
      carrier.current.style.transform = `translate(${at.x}px, ${at.y}px)`;
    }
    drawNeck(socket, at, Math.hypot(at.x - socket.x, at.y - socket.y));
    // At the window edge the overlay takes over, at exactly this spot.
    if (away) leave('pointer crossed the edge');
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const current = phaseRef.current;
    if (current !== 'idle') globLog(`webview saw the release while ${current}`);
    if (current === 'out') void finish(true);
    else if (current === 'free') goHome();
    else if (current === 'pressed') {
      const { start } = drag.current;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      goHome();
      if (moved < CLICK_SLOP) setDialog({ dropped: null });
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setDialog({ dropped: null });
    }
  };

  const usable = support.drag || support.pick;
  const label = support.drag
    ? `Attach a window to ${agent}. Drag onto any window, or press Enter to choose from a list.`
    : `Attach a window to ${agent}`;
  const socketed = phase === 'free' || phase === 'out' || phase === 'home';
  // While its window is attached, the agent shows as away: dimmed, with a linked mark.
  const away = phase === 'idle' && !!attached;
  const tooltipText = attached
    ? `${attached.title} · ${attached.control ? 'can control' : 'see only'}. Click × to detach.`
    : support.drag
      ? `Drag ${agent} onto any window to let it see or control it. Click to pick from a list.`
      : `Let ${agent} see or control another app's window. Click to pick one.`;
  const layer =
    (phase === 'pressed' || phase === 'free' || phase === 'home') && !reduced
      ? createPortal(
          <div className="window-glob-layer" data-phase={phase} aria-hidden="true">
            <svg className="window-glob-neck" width="100%" height="100%" aria-hidden="true">
              <defs>
                <filter id="window-glob-goo">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
                  <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
                </filter>
              </defs>
              <g ref={neck} filter="url(#window-glob-goo)">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <circle key={i} r="0" />
                ))}
              </g>
            </svg>
            {phase !== 'pressed' && (
              <span
                ref={carrier}
                className="window-glob-carrier"
                style={{
                  transform: `translate(${carried.current.x}px, ${carried.current.y}px)`,
                }}
              >
                <GlobFigure provider={provider} motion={motion} />
              </span>
            )}
          </div>,
          document.body,
        )
      : null;
  return (
    <span className="window-glob" data-compact={compact || undefined}>
      <Tooltip
        side={compact ? 'top' : 'bottom'}
        label={tooltipText}
        className={phase === 'idle' ? undefined : 'window-glob-tip-hidden'}
        content={
          <span className="window-glob-tip">
            <strong>{attached ? 'Window attached' : 'Attach a window'}</strong>
            <span>{tooltipText}</span>
          </span>
        }
      >
        <button
          ref={handle}
          type="button"
          className={
            compact ? 'window-glob-handle window-glob-compact' : 'live-mascot window-glob-handle'
          }
          data-phase={phase === 'idle' ? undefined : phase}
          data-socket={socketed || undefined}
          data-away={away || undefined}
          data-target={hovered ? true : undefined}
          aria-label={label}
          disabled={disabled || !usable}
          onPointerEnter={prepare}
          onFocus={prepare}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onLostPointerCapture={() => {
            const current = phaseRef.current;
            if (current === 'idle' || current === 'home') return;
            globLog(`webview lost the pointer while ${current}`);
            // Out on the desktop, native code follows the pointer and the release.
            if (current === 'out') return;
            const { x, y } = lastPointer.current;
            const nearEdge =
              x < EDGE || y < EDGE || x > window.innerWidth - EDGE || y > window.innerHeight - EDGE;
            if (current === 'free' && nearEdge) leave('lost the pointer at the edge');
            else goHome();
          }}
          onClick={(event) => {
            // Pointer presses open the dialog on release; this keeps keyboard and assistive clicks.
            if (!support.drag || event.detail === 0) setDialog({ dropped: null });
          }}
          onKeyDown={onKeyDown}
        >
          <span ref={stretch} className="window-glob-stretch">
            <span
              key={landed}
              ref={mascotRef}
              aria-hidden="true"
              className="window-glob-character"
              data-landed={landed > 0 || undefined}
            >
              {children}
            </span>
          </span>
          {away && (
            <span className="window-glob-away" aria-hidden="true">
              <Link2 size={compact ? 9 : 11} strokeWidth={2.5} />
            </span>
          )}
        </button>
      </Tooltip>
      {hint && !active && (
        <span className="window-glob-hint" role="note">
          Try dragging me onto a window
        </span>
      )}
      {attached && (
        <span className="window-glob-attached">
          <button
            type="button"
            className="window-glob-attached-name"
            title={`${attached.title} · waits ${attached.minutesLeft} more min. Click to show it.`}
            onClick={() => {
              globLog(`revealing the attached ${attached.app} window`);
              void revealAttached(conversation).catch(() => undefined);
            }}
          >
            <AppWindow size={13} aria-hidden="true" />
            On {attached.app}
            {attached.control ? '' : ' · see only'}
          </button>
          <button
            type="button"
            className="window-glob-detach"
            aria-label={`Detach ${attached.title}`}
            onClick={() => {
              void clearAttached(conversation).then(() => {
                setAttached(null);
                setAnnounce('Window detached.');
              });
            }}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      {layer}
      {dialog && (
        <AttachDialog
          conversation={conversation}
          agent={agent}
          provider={provider}
          dropped={dialog.dropped}
          canPick={support.pick}
          badge={support.badge}
          note={note}
          onClose={() => setDialog(null)}
          onAttached={async (window) => {
            setAttached(window);
            setDialog(null);
            setAnnounce(`Attached ${window.title}.`);
            await onAttached(attachMessage(window)).catch(() => undefined);
          }}
        />
      )}
    </span>
  );
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Confirms a dropped window, or lists windows to pick from, and asks what the agent may
 * do with it. Nothing is attached until the person chooses.
 */
function AttachDialog({
  conversation,
  agent,
  provider,
  dropped,
  canPick,
  badge,
  note,
  onClose,
  onAttached,
}: {
  conversation: string;
  agent: string;
  provider: string;
  dropped: AttachTarget | null;
  canPick: boolean;
  badge: boolean;
  note?: string;
  onClose: () => void;
  onAttached: (window: AttachedWindow) => Promise<void>;
}) {
  const [windows, setWindows] = useState<AttachTarget[] | null>(dropped ? [dropped] : null);
  const [chosen, setChosen] = useState<string>(dropped?.handle ?? '');
  const [control, setControl] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The site open in the chosen window when it's a browser: attaching allows it.
  const [site, setSite] = useState<{ handle: string; host: string | null } | null>(null);

  useEffect(() => {
    if (!chosen) return;
    let live = true;
    attachSite(conversation, chosen).then(
      (host) => live && setSite({ handle: chosen, host }),
      () => live && setSite({ handle: chosen, host: null }),
    );
    return () => {
      live = false;
    };
  }, [conversation, chosen]);

  useEffect(() => {
    if (dropped || !canPick) return;
    let live = true;
    attachWindows().then(
      (list) => {
        if (!live) return;
        setWindows(list);
        if (list.length) setChosen(list[0].handle);
      },
      (cause) => live && setError(describeError(cause)),
    );
    return () => {
      live = false;
    };
  }, [dropped, canPick]);

  const attach = async () => {
    setBusy(true);
    setError('');
    try {
      const host = site?.handle === chosen ? site.host : null;
      await onAttached(await confirmAttach(conversation, chosen, control, agent, provider, host));
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };
  const target = windows?.find((window) => window.handle === chosen);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="window-glob-dialog">
        <DialogCloseButton />
        <DialogHeader
          title={dropped ? `Attach ${dropped.app}` : 'Attach a window'}
          description={`Choose what ${agent} can do with it.`}
        />
        <div className="window-glob-dialog-body">
          {!canPick && !dropped ? (
            <InlineNotice>
              {error ||
                'Choosing a window here isn’t available on this desktop. Ask the agent to use desktop control and pick the window in your desktop’s sharing dialog.'}
            </InlineNotice>
          ) : windows === null && !error ? (
            <LoadingState compact label="Finding windows…" />
          ) : dropped ? (
            <p className="window-glob-target">
              <AppWindow size={18} aria-hidden="true" />
              <span>
                <strong>{dropped.title}</strong>
                <span>{dropped.app}</span>
              </span>
            </p>
          ) : windows?.length ? (
            <div className="window-glob-list">
              {windows.map((window) => (
                <Choice
                  key={window.handle}
                  selected={window.handle === chosen}
                  title={window.title}
                  description={window.app}
                  onClick={() => setChosen(window.handle)}
                />
              ))}
            </div>
          ) : (
            !error && <InlineNotice>No other app windows are open.</InlineNotice>
          )}
          {target && (
            <fieldset className="window-glob-modes">
              <legend className="sr-only">What {agent} can do</legend>
              <Choice
                selected={!control}
                leading={<Eye size={18} aria-hidden="true" className="window-glob-mode-icon" />}
                title="See it"
                description="Reads and screenshots it. Can't click or type."
                onClick={() => setControl(false)}
              />
              <Choice
                selected={control}
                leading={
                  <MousePointerClick
                    size={18}
                    aria-hidden="true"
                    className="window-glob-mode-icon"
                  />
                }
                title="See and control"
                description="Also clicks and types. Your mouse or keyboard pauses it."
                onClick={() => setControl(true)}
              />
            </fieldset>
          )}
          {target && site?.handle === chosen && site.host && (
            <p className="window-glob-site">
              <Globe size={16} aria-hidden="true" />
              <span>
                {capitalized(agent)} can use <strong>{site.host}</strong> in this window. Other
                sites still ask first.
              </span>
            </p>
          )}
          <p className="window-glob-note">
            {capitalized(agent)} can use it for the next 30 minutes
            {badge ? '; a badge on the window shows it’s attached' : ''}. Detach anytime with ×.
            {note ? ` ${note}` : ''} Don’t attach windows that show passwords.{' '}
            <LinkButton external onClick={() => void openExternalUrl(ATTACH_HELP_URL)}>
              How this works
            </LinkButton>
          </p>
          {error && (canPick || dropped) && <InlineNotice tone="error">{error}</InlineNotice>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || !target} loading={busy} onClick={() => void attach()}>
            {control ? 'Attach with control' : 'Attach'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
