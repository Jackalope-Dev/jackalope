import { type CanvasHTMLAttributes, useSyncExternalStore } from 'react';
import { ThinkingOrb as Orb, type OrbState } from 'thinking-orbs';
import { cn } from './utils';
import './thinking-orb.css';

export type ThinkingOrbState =
  | 'working'
  | 'searching'
  | 'solving'
  | 'composing'
  | 'breathing'
  | 'connecting'
  | 'planning';
export type ThinkingOrbSize = 20 | 32 | 64;

export interface ThinkingOrbProps
  extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'children' | 'width' | 'height' | 'color'> {
  state?: ThinkingOrbState;
  size?: ThinkingOrbSize;
  /** Holds the current frame. */
  paused?: boolean;
}

const modes: Record<ThinkingOrbState, OrbState> = {
  working: 'working',
  searching: 'searching',
  solving: 'solving',
  composing: 'composing',
  breathing: 'breathing',
  connecting: 'connecting',
  planning: 'weaving',
};

const labels: Record<ThinkingOrbState, string> = {
  working: 'Working',
  searching: 'Searching',
  solving: 'Solving',
  composing: 'Writing',
  breathing: 'Thinking',
  connecting: 'Connecting',
  planning: 'Planning',
};

// The theme writes its tokens onto the root element's style, including --brand-brightness
// (1 in dark themes), and can be dark while the system is light, so the orb follows it
// rather than prefers-color-scheme.
const darkTheme = () =>
  Number(getComputedStyle(document.documentElement).getPropertyValue('--brand-brightness')) >= 0.5;
function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  return () => observer.disconnect();
}

/** A small dotted sphere that names what an agent is doing. Use it for waits of a few seconds or
 *  more, beside text that says the same thing, and unmount it when the work ends. */
export function ThinkingOrb({
  state = 'working',
  size = 20,
  paused = false,
  className,
  ...props
}: ThinkingOrbProps) {
  const dark = useSyncExternalStore(subscribeTheme, darkTheme, () => true);
  const hidden = props['aria-hidden'] === true || props['aria-hidden'] === 'true';
  return (
    <Orb
      aria-label={hidden ? undefined : labels[state]}
      {...props}
      state={modes[state]}
      size={size}
      paused={paused}
      theme={dark ? 'dark' : 'light'}
      className={cn('ui-thinking-orb', className)}
      data-state={state}
    />
  );
}
