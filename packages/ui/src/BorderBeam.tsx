import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from './utils';
import './border-beam.css';

export type BorderBeamVariant = 'travel' | 'line' | 'pulse';

export interface BorderBeamOptions {
  /** `travel` circles the border, `line` sweeps the bottom edge, `pulse` breathes inside it. */
  variant?: BorderBeamVariant;
  /** Drive this from a real state: the beam fades in while true and leaves nothing behind. */
  active?: boolean;
  /** Opacity of the beam layers, 0 to 1. It never dims the wrapped content. */
  strength?: number;
  /**
   * 0 to 1. When set, a pulse follows it (for example a microphone level) instead of
   * breathing. A CSS value such as `var(--voice-level)` follows a level set on an ancestor
   * every frame without re-rendering.
   */
  level?: number | string;
}

const FADE_OUT_MS = 500;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Keeps the layer mounted while it fades out, then removes it. */
function usePresence(active: boolean) {
  const [shown, setShown] = useState(active);
  useEffect(() => {
    if (active) {
      setShown(true);
      return;
    }
    const timer = window.setTimeout(() => setShown(false), reducedMotion() ? 0 : FADE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
  return active || shown;
}

export interface BorderBeamLayerProps extends BorderBeamOptions {
  className?: string;
  /** Overrides the inherited corner radius. */
  radius?: CSSProperties['borderRadius'];
}

/**
 * The beam alone, for an element that is already positioned and rounded: place it as the
 * element's first child. It inherits the element's corner radius, sits over its 1px border
 * (set `--beam-edge` for another width) and never clips the element's other children.
 */
export function BorderBeamLayer({
  variant = 'travel',
  active = true,
  strength = 1,
  level,
  radius,
  className,
}: BorderBeamLayerProps) {
  const present = usePresence(active);
  const layer = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = layer.current;
    if (!present || !node) return;
    let visible = true;
    const sync = () => node.toggleAttribute('data-paused', !visible || document.hidden);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            ([entry]) => {
              visible = entry?.isIntersecting ?? true;
              sync();
            },
            { rootMargin: '128px' },
          );
    observer?.observe(node);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [present]);

  if (!present) return null;
  const style = {
    '--beam-strength': clamp(strength),
    ...(level === undefined
      ? {}
      : { '--beam-level': typeof level === 'number' ? clamp(level) : level }),
    ...(radius === undefined ? {} : { borderRadius: radius }),
  } as CSSProperties;
  return (
    <span
      ref={layer}
      aria-hidden="true"
      className={cn('ui-beam', className)}
      data-variant={variant}
      data-state={active ? 'in' : 'out'}
      data-level={level === undefined ? undefined : ''}
      style={style}
    >
      {variant !== 'pulse' && <span className="ui-beam-bloom" />}
    </span>
  );
}

export interface BorderBeamProps extends BorderBeamOptions, HTMLAttributes<HTMLDivElement> {
  /** Defaults to the first child's top-left corner radius. */
  radius?: CSSProperties['borderRadius'];
}

/**
 * Wraps a rounded element and draws the beam on its edge. The wrapper takes the child's
 * corner radius; make the child fill the wrapper (or size the wrapper to the child).
 */
export const BorderBeam = forwardRef<HTMLDivElement, BorderBeamProps>(
  (
    { variant, active = true, strength, level, radius, className, style, children, ...props },
    ref,
  ) => {
    const wrapper = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => wrapper.current as HTMLDivElement, []);
    const [detected, setDetected] = useState<string>();
    useLayoutEffect(() => {
      if (radius !== undefined || !active) return;
      const child = wrapper.current?.querySelector(':scope > :not(.ui-beam)');
      if (child) setDetected(getComputedStyle(child).borderTopLeftRadius);
    }, [radius, active]);
    return (
      <div
        {...props}
        ref={wrapper}
        className={cn('ui-border-beam', className)}
        style={{ borderRadius: radius ?? detected, ...style }}
      >
        <BorderBeamLayer variant={variant} active={active} strength={strength} level={level} />
        {children}
      </div>
    );
  },
);
BorderBeam.displayName = 'BorderBeam';
