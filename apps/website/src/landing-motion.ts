/**
 * Pure math for the landing page's lanes: one line that forks into a lane per agent, runs
 * down the page and merges again. No DOM access, so it can be unit tested. The fragment
 * shader in ./landing-lanes repeats `laneOpen` and `laneX`; change them together.
 */

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** 0 below `from`, 1 above `to`, eased in between. */
function smoothstep(from: number, to: number, value: number): number {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}

/**
 * Where the lanes are. Horizontal values are in viewport heights from the screen's
 * center; vertical values are in viewport heights from the top of the page.
 */
export interface LaneField {
  /** Middle of the bundle. */
  center: number;
  /** Width of the bundle where the lanes run parallel. */
  spread: number;
  /** The single line starts here and begins to fork. */
  rootY: number;
  /** The lanes are fully parallel from here. */
  forkEnd: number;
  /** The lanes begin to close here and are one line again at `mergeEnd`. */
  mergeStart: number;
  mergeEnd: number;
}

/** How far each lane sways, as a share of the gap between two lanes, so neighbors never cross. */
export const LANE_SWAY = 0.1;

/** How far apart the lanes are at page height `y`: 0 is one line, 1 is fully parallel. */
export function laneOpen(field: LaneField, y: number): number {
  return (
    smoothstep(field.rootY, field.forkEnd, y) *
    (1 - smoothstep(field.mergeStart, field.mergeEnd, y))
  );
}

/** Horizontal position of lane `index` of `count` at page height `y`. */
export function laneX(
  index: number,
  count: number,
  y: number,
  time: number,
  field: LaneField,
): number {
  const gaps = Math.max(1, count - 1);
  const sway = (LANE_SWAY / gaps) * Math.sin(y * 2.3 + index * 1.7 + time * 0.4);
  return field.center + (index / gaps - 0.5 + sway) * field.spread * laneOpen(field, y);
}

/**
 * How stirred up the lanes are, from how fast the page is scrolling. Rises quickly with
 * scroll speed and decays on its own, so work on the lanes speeds up while you scroll.
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
