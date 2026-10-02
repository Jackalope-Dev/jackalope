import { useRef } from 'react';
import './agent-character.css';

export interface AgentGaze {
  x: number;
  y: number;
}

const silhouettes: Record<string, string> = {
  codex:
    'M24 21V14H29V21H47V14H52V21C60 23 64 29 64 37V49C64 60 56 66 44 66H30C18 66 12 59 12 48V38C12 29 16 23 24 21Z',
  claude:
    'M38 10L44 24L57 17L54 32L68 35L57 44L64 57L49 56L45 70L36 58L24 67L23 52L8 51L19 40L11 28L27 29L27 14L38 23Z',
  grok: 'M38 17C52 17 62 27 62 41C62 55 52 65 38 65C24 65 14 55 14 41C14 27 24 17 38 17Z',
  antigravity: 'M10 62L28 19C32 9 43 9 48 19L65 62C48 55 27 55 10 62Z',
  opencode: 'M24 18H52L65 31V54L52 67H24L11 54V31Z',
  kimi: 'M50 16C34 18 20 32 20 48C20 64 34 76 50 72C38 66 30 58 30 44C30 30 38 22 50 16Z',
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

export function AgentCharacter({
  provider,
  state = 'idle',
  gaze,
}: {
  provider: string;
  state?: 'idle' | 'working' | 'waiting';
  gaze?: AgentGaze;
}) {
  const silhouette = silhouettes[provider] ?? silhouettes.codex;
  const blinkDelayRef = useRef<string | undefined>(undefined);
  if (blinkDelayRef.current === undefined) {
    blinkDelayRef.current = `${(Math.random() * 4).toFixed(2)}s`;
  }

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

  return (
    <svg
      className="brand-agent-character"
      data-state={state}
      viewBox="0 0 88 88"
      fill="none"
      aria-hidden="true"
    >
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
        <path d={silhouette} fill="currentColor" />
        {provider === 'grok' && <path d="M12 57C26 54 51 33 64 20" className="brand-agent-orbit" />}
        <g
          className="brand-agent-gaze"
          style={gazeTransform ? { transform: gazeTransform } : undefined}
        >
          <g
            className="brand-agent-face"
            strokeLinecap="round"
            strokeWidth="3.5"
            style={{ animationDelay: blinkDelayRef.current }}
          >
            <path d={state === 'working' ? 'M29 39h4m12 0h4' : 'M31 37v4m16-4v4'} />
            {state === 'waiting' && <path d="M45 30l5-2" strokeWidth="2" />}
          </g>
        </g>
      </g>
    </svg>
  );
}
