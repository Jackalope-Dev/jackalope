import {
  type CSSProperties,
  createContext,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from './utils';
import './liquid.css';

interface LiquidGroup {
  register: (element: HTMLElement) => () => void;
  wake: () => void;
}

const LiquidContext = createContext<LiquidGroup | null>(null);
const SVG = 'http://www.w3.org/2000/svg';
// Frames without movement before the measuring loop goes to sleep.
const SETTLED_FRAMES = 30;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

// A box-shadow-like list becomes chained drop-shadow() filters, which follow the merged shape.
function dropShadows(shadow: string) {
  const layers: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of shadow) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      layers.push(current);
      current = '';
    } else current += char;
  }
  layers.push(current);
  return layers
    .map((layer) => layer.trim())
    .filter(Boolean)
    .map((layer) => `drop-shadow(${layer})`)
    .join(' ');
}

function cornerRadius(element: HTMLElement) {
  const target = (element.firstElementChild as HTMLElement | null) ?? element;
  return getComputedStyle(target).borderTopLeftRadius;
}

export interface LiquidProps extends HTMLAttributes<HTMLDivElement> {
  /** Goo blur in px. Neighbours bridge once it is about as large as the gap between them. */
  blur?: number;
  /** Sharpness of the liquid edge; higher is crisper. */
  contrast?: number;
  /** Colour of the liquid surface. Defaults to the elevated surface. */
  fill?: string;
  /** Shadow on the merged silhouette, in drop-shadow syntax; comma-separate layers. */
  shadow?: string;
}

/**
 * A group whose items share one liquid surface: an SVG layer under the content draws a
 * rounded rect for each item's box and a goo filter merges pieces that touch, so they split
 * and join like liquid while text, icons and focus rings stay crisp DOM above it. Items keep
 * transparent backgrounds; the liquid is their surface. The filter runs on SVG content only,
 * which WebKit supports, and the measuring loop sleeps once nothing moves.
 */
export const Liquid = forwardRef<HTMLDivElement, LiquidProps>(function Liquid(
  { blur = 6, contrast = 18, fill, shadow, className, style, children, ...props },
  ref,
) {
  const filterId = `ui-liquid-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const group = useRef<HTMLDivElement | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const layer = useRef<SVGGElement>(null);
  const pieces = useRef(new Map<HTMLElement, { rect: SVGRectElement; radius: string }>());
  const spread = useRef(blur);
  spread.current = blur;
  const loop = useRef({ frame: 0, still: 0, last: '' });
  const resize = useRef<ResizeObserver | null>(null);

  const measure = useCallback(() => {
    const root = group.current;
    const svg = surface.current;
    if (!root || !svg) return '';
    const origin = root.getBoundingClientRect();
    let minX = 0;
    let minY = 0;
    let maxX = origin.width;
    let maxY = origin.height;
    let signature = '';
    for (const [element, piece] of pieces.current) {
      const box = element.getBoundingClientRect();
      const x = box.left - origin.left;
      const y = box.top - origin.top;
      const scale = element.offsetWidth ? box.width / element.offsetWidth : 1;
      const raw = piece.radius.endsWith('%')
        ? (Number.parseFloat(piece.radius) / 100) * Math.min(box.width, box.height)
        : Number.parseFloat(piece.radius) * scale || 0;
      const radius = Math.min(raw, box.width / 2, box.height / 2);
      piece.rect.setAttribute('x', `${x}`);
      piece.rect.setAttribute('y', `${y}`);
      piece.rect.setAttribute('width', `${Math.max(box.width, 0)}`);
      piece.rect.setAttribute('height', `${Math.max(box.height, 0)}`);
      piece.rect.setAttribute('rx', `${radius}`);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + box.width);
      maxY = Math.max(maxY, y + box.height);
      signature += `${x.toFixed(1)},${y.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)};`;
    }
    // Room for the blur on every side, so the filter never clips the liquid's edge.
    const pad = spread.current * 3 + 4;
    const left = minX - pad;
    const top = minY - pad;
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    svg.style.left = `${left}px`;
    svg.style.top = `${top}px`;
    svg.setAttribute('width', `${width}`);
    svg.setAttribute('height', `${height}`);
    svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
    return signature;
  }, []);

  const wake = useCallback(() => {
    const state = loop.current;
    state.still = 0;
    if (state.frame) return;
    const tick = () => {
      const signature = measure();
      state.still = signature === state.last ? state.still + 1 : 0;
      state.last = signature;
      state.frame = state.still > SETTLED_FRAMES ? 0 : requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
  }, [measure]);

  const context = useMemo<LiquidGroup>(
    () => ({
      register(element) {
        const rect = document.createElementNS(SVG, 'rect');
        layer.current?.appendChild(rect);
        pieces.current.set(element, { rect, radius: cornerRadius(element) });
        resize.current?.observe(element);
        wake();
        return () => {
          rect.remove();
          pieces.current.delete(element);
          resize.current?.unobserve(element);
          wake();
        };
      },
      wake,
    }),
    [wake],
  );

  useLayoutEffect(() => {
    const root = group.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      for (const [element, piece] of pieces.current) piece.radius = cornerRadius(element);
      wake();
    });
    resize.current = observer;
    observer.observe(root);
    for (const element of pieces.current.keys()) observer.observe(element);
    const events = ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart'];
    for (const name of events) root.addEventListener(name, wake);
    measure();
    return () => {
      observer.disconnect();
      resize.current = null;
      for (const name of events) root.removeEventListener(name, wake);
      cancelAnimationFrame(loop.current.frame);
      loop.current.frame = 0;
    };
  }, [measure, wake]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new blur changes the padding around the liquid.
  useEffect(() => {
    wake();
  }, [blur, wake]);

  return (
    <div
      {...props}
      ref={(element) => {
        group.current = element;
        assignRef(ref, element);
      }}
      className={cn('ui-liquid', className)}
      style={{ ...(fill ? { '--liquid-fill': fill } : null), ...style } as CSSProperties}
    >
      <svg
        ref={surface}
        className="ui-liquid-surface"
        aria-hidden="true"
        focusable="false"
        style={shadow ? { filter: dropShadows(shadow) } : undefined}
      >
        <defs>
          <filter
            id={filterId}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${contrast} ${-(contrast / 2.25).toFixed(2)}`}
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
        <g ref={layer} filter={`url(#${filterId})`} />
      </svg>
      <LiquidContext.Provider value={context}>{children}</LiquidContext.Provider>
    </div>
  );
});

export interface LiquidItemProps extends HTMLAttributes<HTMLDivElement> {
  /** Offset from the item's laid-out position, in px; changes animate with `transition`. */
  x?: number;
  y?: number;
  scale?: number;
  transition?: 'snappy' | 'smooth' | 'bouncy';
  /** Delay before an offset change starts, in ms, for staggering pieces. */
  delay?: number;
}

/**
 * One piece of a Liquid group. The group owns this wrapper's `translate` and `scale`; put
 * other transforms on the child. Reduced motion snaps to the new offset.
 */
export const LiquidItem = forwardRef<HTMLDivElement, LiquidItemProps>(function LiquidItem(
  { x = 0, y = 0, scale = 1, transition = 'smooth', delay = 0, className, style, ...props },
  ref,
) {
  const group = useContext(LiquidContext);
  const own = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (group && own.current) return group.register(own.current);
  }, [group]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: transitions wake the group themselves; a new offset also covers snapping under reduced motion.
  useLayoutEffect(() => {
    group?.wake();
  }, [group, x, y, scale]);
  if (!group) throw new Error('LiquidItem must be rendered inside a Liquid group.');
  return (
    <div
      {...props}
      ref={(element) => {
        own.current = element;
        assignRef(ref, element);
      }}
      className={cn('ui-liquid-item', className)}
      data-transition={transition}
      style={
        {
          '--liquid-x': `${x}px`,
          '--liquid-y': `${y}px`,
          '--liquid-scale': scale,
          '--liquid-delay': `${delay}ms`,
          ...style,
        } as CSSProperties
      }
    />
  );
});

export interface LiquidAction {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

export interface LiquidActionsProps {
  /** The trigger's visible label, also the menu's accessible name. */
  label: string;
  /** Shown before the label; turns a quarter towards a close mark while open. */
  icon?: ReactNode;
  actions: readonly LiquidAction[];
  disabled?: boolean;
  className?: string;
}

/**
 * A primary trigger that blooms into a short menu of labelled actions. The actions bead off
 * the trigger with a staggered spring and bridge like liquid until they separate. It is a
 * menu: arrow keys move between actions, Escape or a click elsewhere closes it and returns
 * focus, and closed actions are inert. The actions overlay the page, so opening never
 * shifts layout. The ref is the group, for anchoring a follow-up popover.
 */
export const LiquidActions = forwardRef<HTMLDivElement, LiquidActionsProps>(function LiquidActions(
  { label, icon, actions, disabled, className },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const menuId = `ui-liquid-actions-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const focusOnOpen = useRef<number | null>(null);
  const enabled = actions.flatMap((action, index) => (action.disabled ? [] : [index]));
  const step = useStep(trigger);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  const show = (index: number | undefined) => {
    if (index === undefined) return;
    focusOnOpen.current = index;
    setActive(index);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    if (focusOnOpen.current !== null) {
      items.current[focusOnOpen.current]?.focus();
      focusOnOpen.current = null;
    }
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, close]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const move = (index: number) => {
    setActive(index);
    items.current[index]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const position = enabled.indexOf(active);
    const last = enabled.length - 1;
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'Escape') close(true);
    else if (!enabled.length) return;
    else if (event.key === 'ArrowDown') move(enabled[position >= last ? 0 : position + 1]);
    else if (event.key === 'ArrowUp') move(enabled[position <= 0 ? last : position - 1]);
    else if (event.key === 'Home') move(enabled[0]);
    else if (event.key === 'End') move(enabled[last]);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Liquid
      ref={(element) => {
        root.current = element;
        assignRef(ref, element);
      }}
      className={cn('ui-liquid-actions', className)}
      data-open={open || undefined}
      data-disabled={disabled || undefined}
    >
      <div
        id={menuId}
        role="menu"
        aria-label={label}
        className="ui-liquid-actions-menu"
        inert={!open}
        onKeyDown={onMenuKeyDown}
      >
        {actions.map((action, index) => (
          <LiquidItem
            key={action.id}
            className="ui-liquid-actions-slot"
            y={open ? (index + 1) * step : 0}
            scale={open ? 1 : 0.4}
            transition="bouncy"
            delay={open ? index * 45 : (actions.length - 1 - index) * 25}
          >
            <button
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="menuitem"
              className="ui-liquid-actions-item"
              tabIndex={open && index === active ? 0 : -1}
              aria-disabled={action.disabled || undefined}
              onFocus={() => setActive(index)}
              onClick={() => {
                if (action.disabled) return;
                close(true);
                action.onSelect();
              }}
            >
              {action.icon}
              {action.label}
            </button>
          </LiquidItem>
        ))}
      </div>
      <LiquidItem className="ui-liquid-actions-trigger-slot">
        <button
          ref={trigger}
          type="button"
          className="ui-liquid-actions-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          disabled={disabled}
          onClick={() => (open ? close(false) : show(enabled[0]))}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              show(event.key === 'ArrowDown' ? enabled[0] : enabled[enabled.length - 1]);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              close(true);
            }
          }}
        >
          {icon && <span className="ui-liquid-actions-icon">{icon}</span>}
          {label}
        </button>
      </LiquidItem>
    </Liquid>
  );
});

// Each action sits one trigger height plus a gap below the last, wide enough that resting
// pieces separate at the group's blur while moving ones still bridge.
function useStep(trigger: { current: HTMLButtonElement | null }) {
  const [step, setStep] = useState(50);
  useLayoutEffect(() => {
    const element = trigger.current;
    if (!element) return;
    const update = () => setStep(element.offsetHeight + 14);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [trigger]);
  return step;
}
