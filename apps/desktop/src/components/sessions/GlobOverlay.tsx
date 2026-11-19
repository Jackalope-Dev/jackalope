import { AgentCharacter } from '@jackalope/brand/agent-character';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { type AttachTarget, GLOB_TARGET_EVENT } from '../../lib/window-attach';
import { useWindowTheme } from '../../window-bootstrap';
import './glob-overlay.css';

/** How far the trailing drop may lag behind the blob, in CSS pixels. */
const MAX_STRETCH = 30;

const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The transparent window that follows the pointer while the person drags their agent
 * across the desktop. Native code moves the window; this page turns its movement into a
 * gooey blob that stretches behind the pointer and settles when it stops, and names the
 * window under the pointer.
 */
export function GlobOverlay({ provider }: { provider: string }) {
  useWindowTheme(undefined);
  const [target, setTarget] = useState<AttachTarget | null>(null);
  const tail = useRef<SVGCircleElement>(null);
  const drip = useRef<SVGCircleElement>(null);

  useEffect(() => {
    document.documentElement.classList.add('glob-page');
    return () => document.documentElement.classList.remove('glob-page');
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<AttachTarget | null>(GLOB_TARGET_EVENT, (event) => setTarget(event.payload)).then(
      (stop) => {
        unlisten = stop;
      },
    );
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (reduced()) return;
    const window = getCurrentWindow();
    // The drop springs toward an offset opposite the window's velocity.
    let last: { x: number; y: number; at: number } | null = null;
    let wanted = { x: 0, y: 0 };
    const offset = { x: 0, y: 0 };
    const speed = { x: 0, y: 0 };
    let frame = 0;
    let stop: (() => void) | undefined;
    void window
      .onMoved(({ payload }) => {
        const now = performance.now();
        if (last) {
          const dt = Math.max(8, now - last.at);
          const scale = globalThis.devicePixelRatio || 1;
          const vx = (payload.x - last.x) / scale / dt;
          const vy = (payload.y - last.y) / scale / dt;
          const length = Math.hypot(vx, vy);
          const stretch = Math.min(MAX_STRETCH, length * 22);
          wanted = length ? { x: (-vx / length) * stretch, y: (-vy / length) * stretch } : wanted;
        }
        last = { x: payload.x, y: payload.y, at: now };
      })
      .then((unlisten) => {
        stop = unlisten;
      });
    const step = () => {
      // Wanted drifts back to rest; the drop follows it on a spring, overshooting a little.
      wanted = { x: wanted.x * 0.86, y: wanted.y * 0.86 };
      speed.x = (speed.x + (wanted.x - offset.x) * 0.22) * 0.72;
      speed.y = (speed.y + (wanted.y - offset.y) * 0.22) * 0.72;
      offset.x += speed.x;
      offset.y += speed.y;
      tail.current?.setAttribute('cx', String(48 + offset.x));
      tail.current?.setAttribute('cy', String(48 + offset.y));
      drip.current?.setAttribute('cx', String(48 + offset.x * 1.7));
      drip.current?.setAttribute('cy', String(48 + offset.y * 1.7));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      stop?.();
    };
  }, []);

  return (
    <div className="glob-overlay" data-target={target ? true : undefined}>
      <div className="glob-blob">
        <svg viewBox="0 0 96 96" aria-hidden="true">
          <defs>
            <filter id="glob-goo">
              <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
              <feColorMatrix
                in="blur"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
                result="goo"
              />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          </defs>
          <g filter="url(#glob-goo)" className="glob-body">
            <circle cx="48" cy="48" r="27" />
            <circle ref={tail} cx="48" cy="48" r="19" />
            <circle ref={drip} cx="48" cy="48" r="10" />
          </g>
        </svg>
        <span className="glob-character">
          <AgentCharacter provider={provider} state={target ? 'working' : 'idle'} />
        </span>
      </div>
      <p className="glob-label" role="status">
        {target ? (
          <>
            <span>Attach to {target.app}</span>
            <small>{target.title}</small>
          </>
        ) : (
          <span>Drop on a window</span>
        )}
      </p>
    </div>
  );
}
