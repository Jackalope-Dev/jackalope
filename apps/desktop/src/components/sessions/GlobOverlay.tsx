import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AttachTarget,
  GLOB_BEGIN_EVENT,
  GLOB_FINISH_EVENT,
  GLOB_TARGET_EVENT,
  globLog,
  overlayReady,
} from '../../lib/window-attach';
import { useWindowTheme } from '../../window-bootstrap';
import { GlobFigure } from './GlobFigure';
import { GlobMotion } from './glob-motion';
import './glob-overlay.css';

type Finish = { kind: 'drop' } | { kind: 'return'; dx: number; dy: number };

/** The target window sits under the pointer, up and left of the agent. */
const TOWARD_POINTER = { x: -0.75, y: -0.65 };

/**
 * The transparent window that carries the agent across the desktop. Native code moves
 * the window with the pointer; this page turns that movement into the agent's swing,
 * names the window under the pointer, and plays the splat on a drop or the spring home on
 * a cancel. It is reused for every drag and reports its first painted frame, so the
 * window never shows before it is transparent.
 */
export function GlobOverlay() {
  useWindowTheme(undefined);
  const motion = useMemo(() => new GlobMotion(), []);
  const [provider, setProvider] = useState('auto');
  const [target, setTarget] = useState<AttachTarget | null>(null);
  const [finish, setFinish] = useState<Finish | null>(null);
  /** Bumped when a target is lost, to replay the shiver. */
  const [missed, setMissed] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    globLog('overlay page mounted');
    const failed = (event: ErrorEvent | PromiseRejectionEvent) =>
      globLog(
        `overlay error: ${'message' in event ? event.message : String(event.reason).slice(0, 200)}`,
      );
    window.addEventListener('error', failed);
    window.addEventListener('unhandledrejection', failed);
    // Two frames: the transparent page has been composited, not just laid out.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => void overlayReady().catch(() => undefined));
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('error', failed);
      window.removeEventListener('unhandledrejection', failed);
    };
  }, []);

  useEffect(() => {
    const stops: Array<Promise<() => void>> = [
      listen<{ provider: string }>(GLOB_BEGIN_EVENT, (event) => {
        globLog(`overlay began a drag (${event.payload.provider || 'auto'})`);
        motion.reset();
        setProvider(event.payload.provider || 'auto');
        setTarget(null);
        setFinish(null);
      }),
      listen<AttachTarget | null>(GLOB_TARGET_EVENT, (event) => {
        if (!event.payload && targetRef.current) setMissed((value) => value + 1);
        setTarget(event.payload);
      }),
      listen<Finish>(GLOB_FINISH_EVENT, (event) => {
        globLog(`overlay finishing: ${event.payload.kind}`);
        setFinish(event.payload);
      }),
    ];
    const window = getCurrentWindow();
    const scale = () => globalThis.devicePixelRatio || 1;
    stops.push(
      window.onMoved(({ payload }) => motion.push(payload.x / scale(), payload.y / scale())),
    );
    return () => {
      for (const stop of stops) void stop.then((unlisten) => unlisten());
    };
  }, [motion]);

  const style =
    finish?.kind === 'return'
      ? ({ '--home-x': finish.dx, '--home-y': finish.dy } as CSSProperties)
      : undefined;
  return (
    <div className="glob-overlay" data-finish={finish?.kind} style={style}>
      <span className="glob-anchor">
        <span key={missed} className="glob-shake" data-missed={missed > 0 || undefined}>
          <GlobFigure
            provider={provider}
            motion={motion}
            over={!!target}
            lookAt={target ? TOWARD_POINTER : null}
          />
        </span>
        {target && <span key={target.handle} className="glob-ripple" />}
        {finish?.kind === 'drop' && <span className="glob-splat" />}
      </span>
      {!finish && (
        <p className="glob-label" role="status" key={target?.handle ?? 'none'}>
          {target ? (
            <>
              <span>Attach to {target.app}</span>
              <small>{target.title}</small>
            </>
          ) : (
            <span>Drop on any window</span>
          )}
        </p>
      )}
    </div>
  );
}
