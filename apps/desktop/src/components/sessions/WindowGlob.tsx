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
  LoadingState,
} from '@jackalope/ui';
import { listen } from '@tauri-apps/api/event';
import { AppWindow, X } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  type AttachedWindow,
  type AttachSupport,
  type AttachTarget,
  attachedWindow,
  attachMessage,
  attachSupport,
  attachWindows,
  clearAttached,
  confirmAttach,
  endGlob,
  GLOB_TARGET_EVENT,
  startGlob,
} from '../../lib/window-attach';
import './window-glob.css';

/** Pointer travel before a press on the agent becomes a drag. */
const DRAG_THRESHOLD = 6;

type Phase = { kind: 'idle' } | { kind: 'pressed'; x: number; y: number } | { kind: 'dragging' };

/**
 * The conversation's agent, which can be dragged out of Jackalope onto any window to
 * attach it, or clicked to pick a window from a list. Attaching stages one window: the
 * agent's next desktop access request takes it without asking again, and nothing is
 * shared before that.
 */
export function WindowGlob({
  conversation,
  provider,
  agent,
  disabled,
  mascotRef,
  onAttached,
  children,
}: {
  conversation: string;
  provider: string;
  agent: string;
  disabled?: boolean;
  mascotRef: RefObject<HTMLSpanElement | null>;
  /** Adds the attach note to the composer. */
  onAttached: (text: string) => Promise<void>;
  children: ReactNode;
}) {
  const [support, setSupport] = useState<AttachSupport>({ drag: false, pick: false });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [hovered, setHovered] = useState<AttachTarget | null>(null);
  const [announce, setAnnounce] = useState('');
  const [dialog, setDialog] = useState<{ dropped: AttachTarget | null } | null>(null);
  const [attached, setAttached] = useState<AttachedWindow | null>(null);
  const ending = useRef(false);

  useEffect(() => {
    let live = true;
    void attachSupport()
      .then((value) => live && setSupport(value))
      .catch(() => undefined);
    void attachedWindow(conversation)
      .then((value) => live && setAttached(value))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [conversation]);

  const dragging = phase.kind === 'dragging';
  useEffect(() => {
    if (!dragging) return;
    let unlisten: (() => void) | undefined;
    void listen<AttachTarget | null>(GLOB_TARGET_EVENT, (event) => {
      setHovered(event.payload);
      setAnnounce(
        event.payload ? `Over ${event.payload.app}: ${event.payload.title}` : 'Not over a window',
      );
    }).then((stop) => {
      unlisten = stop;
    });
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') void finishRef.current(false);
    };
    window.addEventListener('keydown', cancel);
    return () => {
      unlisten?.();
      window.removeEventListener('keydown', cancel);
    };
  }, [dragging]);

  const finishRef = useRef(finish);
  finishRef.current = finish;
  async function finish(drop: boolean) {
    if (ending.current || phaseRef.current.kind !== 'dragging') return;
    ending.current = true;
    setPhase({ kind: 'idle' });
    setHovered(null);
    try {
      const target = await endGlob(drop);
      if (!drop) setAnnounce('Canceled.');
      else if (target) {
        setAnnounce(`Dropped on ${target.app}: ${target.title}`);
        setDialog({ dropped: target });
      } else setAnnounce('No window there. Drop the agent onto another app’s window.');
    } catch (error) {
      setAnnounce(describeError(error));
    } finally {
      ending.current = false;
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0 || !support.drag) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPhase({ kind: 'pressed', x: event.clientX, y: event.clientY });
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = phaseRef.current;
    if (current.kind !== 'pressed') return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return;
    setPhase({ kind: 'dragging' });
    setAnnounce(`Dragging ${agent}. Drop it on a window, or press Escape to cancel.`);
    void startGlob(conversation, provider).catch((error) => {
      setPhase({ kind: 'idle' });
      setAnnounce(describeError(error));
      setDialog({ dropped: null });
    });
  };
  const onPointerUp = () => {
    const current = phaseRef.current;
    if (current.kind === 'dragging') void finish(true);
    else if (current.kind === 'pressed') {
      setPhase({ kind: 'idle' });
      setDialog({ dropped: null });
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
  return (
    <>
      <button
        type="button"
        className="live-mascot window-glob-handle"
        data-dragging={dragging || undefined}
        data-target={hovered ? true : undefined}
        aria-label={label}
        title={usable ? 'Drag me onto a window, or click to attach one' : undefined}
        disabled={disabled || !usable}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={() => {
          if (phaseRef.current.kind === 'dragging') void finish(true);
        }}
        onClick={(event) => {
          // Pointer presses open the dialog on release; this keeps keyboard and assistive clicks.
          if (!support.drag || event.detail === 0) setDialog({ dropped: null });
        }}
        onKeyDown={onKeyDown}
      >
        <span ref={mascotRef} aria-hidden="true" className="window-glob-character">
          {children}
        </span>
      </button>
      {attached && (
        <span className="window-glob-attached">
          <AppWindow size={13} aria-hidden="true" />
          <span className="window-glob-attached-name" title={`${attached.title} · ${attached.app}`}>
            {attached.app}
            {attached.control ? '' : ' · read only'}
          </span>
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
      {dialog && (
        <AttachDialog
          conversation={conversation}
          agent={agent}
          dropped={dialog.dropped}
          canPick={support.pick}
          onClose={() => setDialog(null)}
          onAttached={async (window) => {
            setAttached(window);
            setDialog(null);
            setAnnounce(`Attached ${window.title}.`);
            await onAttached(attachMessage(window)).catch(() => undefined);
          }}
        />
      )}
    </>
  );
}

/**
 * Confirms a dropped window, or lists windows to pick from. Nothing is attached until
 * the person chooses how the agent may use it.
 */
function AttachDialog({
  conversation,
  agent,
  dropped,
  canPick,
  onClose,
  onAttached,
}: {
  conversation: string;
  agent: string;
  dropped: AttachTarget | null;
  canPick: boolean;
  onClose: () => void;
  onAttached: (window: AttachedWindow) => Promise<void>;
}) {
  const [windows, setWindows] = useState<AttachTarget[] | null>(dropped ? [dropped] : null);
  const [chosen, setChosen] = useState<string>(dropped?.handle ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  const attach = async (control: boolean) => {
    setBusy(true);
    setError('');
    try {
      await onAttached(await confirmAttach(conversation, chosen, control));
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
          title={dropped ? `Attach ${dropped.app}?` : 'Attach a window'}
          description={`${agent} can use it the next time it asks for desktop access. Nothing is shared before then, and a frame and bar show while it works. Escape or Stop ends access.`}
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
              <AppWindow size={16} aria-hidden="true" />
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
          <p className="window-glob-note">
            Don’t attach a window that shows passwords or other secrets.
          </p>
          {error && (canPick || dropped) && <InlineNotice tone="error">{error}</InlineNotice>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" disabled={busy || !target} onClick={() => void attach(false)}>
            Let {agent} see it
          </Button>
          <Button disabled={busy || !target} loading={busy} onClick={() => void attach(true)}>
            See and control
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
