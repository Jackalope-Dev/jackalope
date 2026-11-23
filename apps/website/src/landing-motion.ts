/** Pure math for the landing page's scroll choreography. No DOM access, so it can be unit tested. */

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** 0 below `from`, 1 above `to`, eased in between. */
function smoothstep(from: number, to: number, value: number): number {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}

export interface HeroState {
  /** Scale of the name. Grows fast near the end so the camera passes through a letter. */
  scale: number;
  /** Opacity of the layer the name is cut from. */
  maskOpacity: number;
  /** Opacity of the heading, actions and scroll cue. */
  metaOpacity: number;
  /** How far the field is washed toward the page color: 0 inside the letters. */
  wash: number;
}

const MAX_ZOOM = 90;

/**
 * How far the field fades toward the page color under body text, where that text has to
 * stay readable: toward black in the dark appearance, toward white in the light one.
 */
export const READING_WASH = { dark: 0.74, light: 0.9 };

/** Where the hero is for a scroll progress of 0 (top of page) to 1 (hero finished). */
export function heroState(progress: number, readingWash: number): HeroState {
  const p = clamp(progress);
  return {
    scale: 1 + p ** 3 * MAX_ZOOM,
    maskOpacity: 1 - smoothstep(0.5, 0.86, p),
    metaOpacity: 1 - smoothstep(0.04, 0.3, p),
    wash: readingWash * smoothstep(0.55, 1, p),
  };
}

/** How far a position has moved through a range, as 0 to 1. */
export function progressThrough(position: number, start: number, end: number): number {
  return clamp((position - start) / (end - start));
}

/**
 * How stirred up the field is, from how fast the page is scrolling. Rises quickly with
 * scroll speed and decays on its own, so the background surges while you scroll and
 * settles when you stop.
 *
 * @param energy current energy, 0 (calm) to 1 (fully stirred)
 * @param scrolled distance scrolled this frame, as a fraction of the viewport height
 */
export function scrollEnergy(energy: number, scrolled: number): number {
  return Math.max(energy, clamp(Math.abs(scrolled) * 18)) * 0.94;
}

export type Rgb = [number, number, number];

/** "#rrggbb" to components in 0..1, the form WebGL uniforms take. */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a #rrggbb color: "${hex}"`);
  return [match[1], match[2], match[3]].map(
    (channel) => Number.parseInt(channel ?? '0', 16) / 255,
  ) as Rgb;
}

/** Moves `current` a fraction of the way toward `target`. Called once per frame. */
export function approach(current: Rgb, target: Rgb, rate: number): Rgb {
  return current.map((value, i) => value + ((target[i] ?? value) - value) * rate) as Rgb;
}

/** WCAG contrast ratio between two "#rrggbb" colors. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map((c) =>
      c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    ) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
