import {
  type CSSProperties,
  type MouseEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import './agent-character.css';

export interface AgentGaze {
  x: number;
  y: number;
}

export type AgentCharacterState = 'idle' | 'working' | 'waiting';

const silhouettes: Record<string, string> = {
  codex:
    'M24 21V14H29V21H47V14H52V21C60 23 64 29 64 37V49C64 60 56 66 44 66H30C18 66 12 59 12 48V38C12 29 16 23 24 21Z',
  claude:
    'M38 10L44 24L57 17L54 32L68 35L57 44L64 57L49 56L45 70L36 58L24 67L23 52L8 51L19 40L11 28L27 29L27 14L38 23Z',
  grok: 'M38 17C52 17 62 27 62 41C62 55 52 65 38 65C24 65 14 55 14 41C14 27 24 17 38 17Z',
  antigravity: 'M10 62L28 19C32 9 43 9 48 19L65 62C48 55 27 55 10 62Z',
  opencode: 'M24 18H52L65 31V54L52 67H24L11 54V31Z',
  // A full moon with a bite from the right: still a crescent, wide enough for the face.
  kimi: 'M62.7 27.6A28 28 0 1 0 62.7 60.4A18 18 0 0 1 62.7 27.6Z',
  // Bot-only shapes. Each keeps the face (x 31 and 47, y 37 to 41) inside the fill.
  moon: 'M47.3 17A28 28 0 1 0 67 36.7A17 17 0 0 1 47.3 17Z',
  blob: 'M40 14C56 12 68 24 66 40C64 56 56 68 40 68C22 68 12 58 12 42C12 26 24 16 40 14Z',
  heart:
    'M39 68C30 61 12 50 12 34C12 22 21 15 30 15C35 15 38 18 39 21C40 18 43 15 48 15C57 15 66 22 66 34C66 50 48 61 39 68Z',
  cloud:
    'M22 64C13 64 8 57 9 50C10 43 15 40 20 40C19 30 26 22 36 22C43 22 48 26 51 31C61 30 69 37 68 47C67 57 60 64 52 64Z',
  ghost: 'M14 70V38C14 23 25 13 39 13C53 13 64 23 64 38V70L57 64L50 70L43 64L36 70L29 64L21 70Z',
  cat: 'M16 66C12 58 12 44 16 34L14 12L30 24C36 22 44 22 50 24L64 12L62 34C66 44 66 58 62 66C54 72 24 72 16 66Z',
  gem: 'M24 16H54L68 34L39 70L10 34Z',
  shield: 'M39 12L64 20V40C64 56 52 66 39 72C26 66 14 56 14 40V20Z',
  sprout:
    'M40 22C55 22 66 33 66 47C66 61 55 70 40 70C25 70 14 61 14 47C14 33 25 22 40 22ZM40 22C38 14 42 8 50 8C50 15 46 20 40 22Z',
};

// Characters drawn at least this wide get a ground shadow; smaller ones stay clean.
const LARGE = 48;

// One observer of each kind serves every character on the page.
const characters = new Set<SVGSVGElement>();
let visibility: IntersectionObserver | undefined;
let sizing: ResizeObserver | undefined;

function syncHidden() {
  for (const element of characters) {
    element.toggleAttribute('data-hidden', document.hidden);
  }
}

function track(element: SVGSVGElement) {
  if (typeof window === 'undefined') return () => {};
  if (characters.size === 0) document.addEventListener('visibilitychange', syncHidden);
  characters.add(element);
  element.toggleAttribute('data-hidden', document.hidden);
  if ('IntersectionObserver' in window) {
    visibility ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.toggleAttribute('data-offscreen', !entry.isIntersecting);
        }
      },
      { rootMargin: '64px' },
    );
    visibility.observe(element);
  }
  if ('ResizeObserver' in window) {
    sizing ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        entry.target.toggleAttribute('data-large', entry.contentRect.width >= LARGE);
      }
    });
    sizing.observe(element);
  }
  return () => {
    characters.delete(element);
    visibility?.unobserve(element);
    sizing?.unobserve(element);
    if (characters.size === 0) document.removeEventListener('visibilitychange', syncHidden);
  };
}

function reducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

function randomBetween(low: number, high: number) {
  return low + Math.random() * (high - low);
}

export function AgentCharacter({
  provider,
  state = 'idle',
  gaze,
  material = 'plush',
  interactive = false,
  onClick,
}: {
  provider: string;
  state?: AgentCharacterState;
  gaze?: AgentGaze;
  /** Plush adds soft studio shading, bead eyes and, at larger sizes, a ground shadow. */
  material?: 'plush' | 'flat';
  /** A click makes the character hop and turn round. Leave off inside clickable rows. */
  interactive?: boolean;
  onClick?: (event: MouseEvent<SVGSVGElement>) => void;
}) {
  const silhouette = silhouettes[provider] ?? silhouettes.codex;
  const id = `brand-agent-${useId().replace(/[^\w-]/g, '')}`;
  const root = useRef<SVGSVGElement>(null);
  const body = useRef<SVGGElement>(null);
  const turn = useRef<SVGGElement>(null);
  // Per-instance timing, so a row of characters never blinks, glances or jumps in unison.
  const timing = useRef<Record<string, string> | undefined>(undefined);
  if (timing.current === undefined) {
    timing.current = {
      '--brand-agent-blink-delay': `${randomBetween(0, 4).toFixed(2)}s`,
      '--brand-agent-glance-delay': `${randomBetween(-11, 0).toFixed(2)}s`,
      '--brand-agent-idle-period': `${randomBetween(13, 19).toFixed(2)}s`,
      '--brand-agent-idle-delay': `${randomBetween(-12, -2).toFixed(2)}s`,
      '--brand-agent-work-delay': `${randomBetween(-0.25, 0).toFixed(2)}s`,
    };
  }
  const [poke, setPoke] = useState(0);

  useEffect(() => {
    const element = root.current;
    return element ? track(element) : undefined;
  }, []);

  // Changing state swaps CSS animations, which would snap mid-hop. Capture the pose the old
  // animation left on screen while the old DOM is still committed, then ease out of it.
  const previous = useRef(state);
  const outgoing = useRef<{ body: string; turn: string } | null>(null);
  if (previous.current !== state) {
    previous.current = state;
    outgoing.current =
      body.current && turn.current && !reducedMotion()
        ? {
            body: getComputedStyle(body.current).transform,
            turn: getComputedStyle(turn.current).transform,
          }
        : null;
  }
  useLayoutEffect(() => {
    const from = outgoing.current;
    outgoing.current = null;
    if (!from || !body.current?.animate) return;
    const settle = { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
    for (const [element, transform] of [
      [body.current, from.body],
      [turn.current, from.turn],
    ] as const) {
      if (element && transform && transform !== 'none') {
        element.animate([{ transform }, { transform: 'none' }], settle);
      }
    }
  });

  useEffect(() => {
    if (!poke) return;
    const timer = window.setTimeout(() => setPoke(0), 720);
    return () => window.clearTimeout(timer);
  }, [poke]);

  const clampedX = gaze ? Math.max(-1, Math.min(1, gaze.x)) : 0;
  const clampedY = gaze ? Math.max(-1, Math.min(1, gaze.y)) : 0;

  const eyeDx = gaze ? Number((clampedX * 8.5).toFixed(2)) : 0;
  const eyeDy = gaze ? Number((clampedY * 6).toFixed(2)) : 0;
  const headRotate = gaze ? Number((clampedX * 5.5).toFixed(2)) : 0;
  const headDx = gaze ? Number((clampedX * 3.5).toFixed(2)) : 0;
  const headDy = gaze ? Number((clampedY * 3).toFixed(2)) : 0;

  const headTransform = gaze
    ? `translate(${headDx}px, ${headDy}px) rotate(${headRotate}deg)`
    : undefined;
  const gazeTransform = gaze ? `translate(${eyeDx}px, ${eyeDy}px)` : undefined;
  const plush = material === 'plush';
  const eyes = state === 'working' ? 'M29 39h4m12 0h4' : 'M31 37v4m16-4v4';

  return (
    <svg
      ref={root}
      className="brand-agent-character"
      data-state={state}
      data-material={material}
      data-glance={gaze ? undefined : ''}
      data-interactive={interactive || undefined}
      // Alternating values restart the one-shot animation on a quick second click.
      data-poke={poke ? (poke % 2 ? 'a' : 'b') : undefined}
      viewBox="0 0 88 88"
      fill="none"
      aria-hidden="true"
      style={timing.current as CSSProperties}
      onClick={
        interactive || onClick
          ? (event) => {
              if (interactive) setPoke((count) => count + 1);
              onClick?.(event);
            }
          : undefined
      }
    >
      {plush && (
        <defs>
          <clipPath id={`${id}-clip`}>
            <path d={silhouette} />
          </clipPath>
          <radialGradient id={`${id}-shade`} cx="0.3" cy="0.22" r="0.95">
            <stop offset="0" className="brand-agent-stop-light" />
            <stop offset="0.42" className="brand-agent-stop-clear" />
            <stop offset="0.72" className="brand-agent-stop-clear" />
            <stop offset="1" className="brand-agent-stop-dark" />
          </radialGradient>
          <linearGradient id={`${id}-rim`} x1="1" y1="0" x2="0.35" y2="0.75">
            <stop offset="0" className="brand-agent-stop-rim" />
            <stop offset="0.55" className="brand-agent-stop-clear" />
          </linearGradient>
        </defs>
      )}
      {plush && <ellipse className="brand-agent-ground" cx="42" cy="80" rx="22" ry="3" />}
      <g ref={body} className="brand-agent-body">
        <g className="brand-agent-lean">
          <g ref={turn} className="brand-agent-turn">
            <g
              className="brand-agent-head"
              style={headTransform ? { transform: headTransform } : undefined}
            >
              {[4, 3, 2, 1].map((layer) => (
                <path
                  key={layer}
                  d={silhouette}
                  transform={`translate(${layer * 3} ${layer * 1.5})`}
                  className="brand-agent-echo"
                />
              ))}
              <g className="brand-agent-fill">
                <path d={silhouette} fill="currentColor" />
                {plush && (
                  <g clipPath={`url(#${id}-clip)`}>
                    <path d={silhouette} fill={`url(#${id}-shade)`} />
                    <path
                      d={silhouette}
                      stroke={`url(#${id}-rim)`}
                      strokeWidth="5"
                      className="brand-agent-rim"
                    />
                  </g>
                )}
              </g>
              {provider === 'grok' && (
                <path d="M12 57C26 54 51 33 64 20" className="brand-agent-orbit" />
              )}
              <g
                className="brand-agent-gaze"
                style={gazeTransform ? { transform: gazeTransform } : undefined}
              >
                <g className="brand-agent-glance">
                  <g className="brand-agent-face" strokeLinecap="round" strokeWidth="3.5">
                    <path d={eyes} />
                    {plush && state !== 'working' && (
                      <g className="brand-agent-bead">
                        <circle cx="31.6" cy="37.6" r="0.9" />
                        <circle cx="47.6" cy="37.6" r="0.9" />
                      </g>
                    )}
                    {state === 'waiting' && <path d="M45 30l5-2" strokeWidth="2" />}
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
