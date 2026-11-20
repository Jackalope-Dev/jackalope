import { AgentCharacter, type AgentGaze } from '@jackalope/brand/agent-character';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { type GlobMotion, prefersReducedMotion } from './glob-motion';
import './glob-figure.css';

/** How often the eyes may change; each change re-renders the character. */
const GAZE_EVERY = 90;

/**
 * The dragged agent: its own character, hanging from the pointer with a soft glow in the
 * theme accent that brightens with speed and over a window it can attach to. Motion is
 * transforms and opacity only, driven by `motion` once per frame; with reduced motion it
 * holds still with a steady glow.
 */
export function GlobFigure({
  provider,
  motion,
  over,
  lookAt,
  size = 44,
  className,
  style,
}: {
  provider: string;
  motion: GlobMotion;
  /** Over a window it can attach to. */
  over?: boolean;
  /** Where to look instead of the travel direction, such as toward the target. */
  lookAt?: AgentGaze | null;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const swing = useRef<HTMLSpanElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const [gaze, setGaze] = useState<AgentGaze>({ x: 0, y: 0 });
  const overRef = useRef(over);
  overRef.current = over;
  const lookRef = useRef(lookAt);
  lookRef.current = lookAt;

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let frame = 0;
    let lastGaze = { x: 0, y: 0, at: 0 };
    // When the pointer rests, the agent glances around now and then.
    let glance = { x: 0, y: 0, until: 0, next: performance.now() + 1200 };
    const tick = (now: number) => {
      const pose = motion.step(now);
      const lift = overRef.current ? 1.1 : 1;
      if (swing.current)
        swing.current.style.transform = `translate(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px) rotate(${pose.angle.toFixed(2)}deg) scale(${(pose.scaleX * lift).toFixed(3)}, ${(pose.scaleY * lift).toFixed(3)})`;
      if (glow.current) {
        const strength = Math.min(1, 0.45 + pose.speed * 0.35 + (overRef.current ? 0.4 : 0));
        glow.current.style.opacity = strength.toFixed(3);
        glow.current.style.transform = `translate(${(pose.x * 0.6).toFixed(2)}px, ${(pose.y * 0.6).toFixed(2)}px) scale(${(0.9 + strength * 0.35).toFixed(3)})`;
      }
      let target = lookRef.current ?? null;
      if (!target && pose.speed > 0.08) target = { x: pose.dirX, y: pose.dirY };
      if (!target) {
        if (now > glance.next) {
          const angle = Math.random() * Math.PI * 2;
          glance = {
            x: Math.cos(angle) * 0.8,
            y: Math.sin(angle) * 0.6,
            until: now + 650,
            next: now + 1400 + Math.random() * 1600,
          };
        }
        target = now < glance.until ? glance : { x: 0, y: 0 };
      }
      if (
        now - lastGaze.at > GAZE_EVERY &&
        Math.hypot(target.x - lastGaze.x, target.y - lastGaze.y) > 0.15
      ) {
        lastGaze = { x: target.x, y: target.y, at: now };
        setGaze({ x: target.x, y: target.y });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [motion]);

  return (
    <span
      className={`glob-figure${className ? ` ${className}` : ''}`}
      data-over={over || undefined}
      style={{ '--glob-size': `${size}px`, ...style } as CSSProperties}
      aria-hidden="true"
    >
      <span ref={glow} className="glob-glow" />
      <span ref={swing} className="glob-swing">
        <AgentCharacter provider={provider} state={over ? 'working' : 'idle'} gaze={gaze} />
      </span>
    </span>
  );
}
