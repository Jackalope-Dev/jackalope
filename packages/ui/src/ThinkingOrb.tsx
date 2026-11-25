import { type CanvasHTMLAttributes, useEffect, useRef } from 'react';
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
  extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'children' | 'width' | 'height'> {
  state?: ThinkingOrbState;
  size?: ThinkingOrbSize;
  /** Holds the current frame and leaves the shared loop. */
  paused?: boolean;
}

const labels: Record<ThinkingOrbState, string> = {
  working: 'Working',
  searching: 'Searching',
  solving: 'Solving',
  composing: 'Writing',
  breathing: 'Thinking',
  connecting: 'Connecting',
  planning: 'Planning',
};

/** A small dotted sphere that names what an agent is doing. Use it for waits of a few seconds or
 *  more, beside text that says the same thing, and unmount it when the work ends. */
export function ThinkingOrb({
  state = 'working',
  size = 20,
  paused = false,
  className,
  style,
  ...props
}: ThinkingOrbProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ state, size, paused });
  const orb = useRef<Orb | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const instance = new Orb(element, settings);
    orb.current = instance;
    return () => {
      instance.dispose();
      orb.current = null;
    };
  }, []);

  useEffect(() => {
    settings.current = { state, size, paused };
    orb.current?.update();
  }, [state, size, paused]);

  const hidden = props['aria-hidden'] === true || props['aria-hidden'] === 'true';
  return (
    <canvas
      ref={canvas}
      role={hidden ? undefined : 'img'}
      aria-label={hidden ? undefined : labels[state]}
      {...props}
      className={cn('ui-thinking-orb', className)}
      data-state={state}
      style={{ width: size, height: size, ...style }}
    />
  );
}

type Rgb = [number, number, number];
type Settings = { state: ThinkingOrbState; size: ThinkingOrbSize; paused: boolean };
/** A point in sphere space: y up, z toward the viewer, unit radius. */
type Point = [number, number, number];
interface Dot {
  x: number;
  y: number;
  z: number;
  radius: number;
  alpha: number;
  hot: number;
}
type Emit = (point: Point, alpha: number, hot: number, scale?: number) => void;
interface Tune {
  dot: number;
  globe: number;
  ring: number;
  layers: number;
}

const tunes: Record<ThinkingOrbSize, Tune> = {
  20: { dot: 1, globe: 30, ring: 16, layers: 3 },
  32: { dot: 1.2, globe: 64, ring: 24, layers: 4 },
  64: { dot: 1.55, globe: 170, ring: 40, layers: 5 },
};

// The view looks down on the sphere a little so latitude rings read as ellipses.
const viewTilt: Record<ThinkingOrbState, number> = {
  working: 0.35,
  searching: 0.38,
  solving: 0.42,
  composing: 0.72,
  breathing: 0,
  connecting: 0.3,
  planning: 0.3,
};

// A readable single frame for reduced motion, per state.
const stillTime: Record<ThinkingOrbState, number> = {
  working: 1.2,
  searching: 0.55,
  solving: 0.6,
  composing: 0.8,
  breathing: 0.4,
  connecting: 3.4,
  planning: 0.9,
};

const TAU = Math.PI * 2;
const FRAME_MS = 1000 / 30 - 3;

// One clock and one requestAnimationFrame loop for every orb, so they stay in phase and cost a
// single callback. The loop stops while the document is hidden and restarts when it returns.
const running = new Set<Orb>();
let frame = 0;
let lastFrame = 0;
let watchingVisibility = false;

function tick(now: number) {
  frame = 0;
  if (document.hidden || !running.size) return;
  frame = requestAnimationFrame(tick);
  if (now - lastFrame < FRAME_MS) return;
  lastFrame = now;
  for (const orb of running) orb.draw(now / 1000);
}

function startLoop() {
  if (!watchingVisibility) {
    watchingVisibility = true;
    document.addEventListener('visibilitychange', startLoop);
  }
  if (!frame && running.size && !document.hidden) frame = requestAnimationFrame(tick);
}

class Orb {
  private canvas: HTMLCanvasElement;
  private settings: { current: Settings };
  private context: CanvasRenderingContext2D | null;
  private ink: Rgb = [128, 128, 128];
  private accent: Rgb = [128, 128, 128];
  private visible = true;
  private time = performance.now() / 1000;
  private scale = 0;
  private motion: MediaQueryList;
  private intersection: IntersectionObserver | null = null;
  private theme: MutationObserver;

  constructor(canvas: HTMLCanvasElement, settings: { current: Settings }) {
    this.canvas = canvas;
    this.settings = settings;
    this.context = canvas.getContext('2d');
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', this.update);
    this.theme = new MutationObserver(this.refreshColors);
    this.theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme'],
    });
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersection = new IntersectionObserver(
        ([entry]) => {
          this.visible = entry?.isIntersecting ?? true;
          this.update();
        },
        { rootMargin: '64px' },
      );
      this.intersection.observe(canvas);
    }
    this.readColors();
    this.update();
  }

  dispose() {
    running.delete(this);
    this.motion.removeEventListener('change', this.update);
    this.theme.disconnect();
    this.intersection?.disconnect();
  }

  update = () => {
    const { paused } = this.settings.current;
    const reduced = this.motion.matches;
    if (!reduced && !paused && this.visible) {
      running.add(this);
      startLoop();
      this.draw(performance.now() / 1000);
    } else {
      running.delete(this);
      this.draw(reduced ? stillTime[this.settings.current.state] : this.time, true);
    }
  };

  private refreshColors = () => {
    this.readColors();
    if (!running.has(this)) this.update();
  };

  private readColors() {
    const computed = getComputedStyle(this.canvas);
    const fallback = parseColor(computed.color) ?? [128, 128, 128];
    this.ink = parseColor(computed.getPropertyValue('--color-text-primary')) ?? fallback;
    this.accent = parseColor(computed.getPropertyValue('--color-accent')) ?? this.ink;
  }

  draw(time: number, hold = false) {
    const context = this.context;
    if (!context) return;
    if (!hold) this.time = time;
    const { state, size } = this.settings.current;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const pixels = Math.round(size * ratio);
    if (this.canvas.width !== pixels || this.canvas.height !== pixels || this.scale !== ratio) {
      this.canvas.width = pixels;
      this.canvas.height = pixels;
      this.scale = ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);
    renderOrb(context, state, size, time, this.ink, this.accent);
  }
}

function renderOrb(
  context: CanvasRenderingContext2D,
  state: ThinkingOrbState,
  size: ThinkingOrbSize,
  time: number,
  ink: Rgb,
  accent: Rgb,
) {
  const tune = tunes[size];
  const center = size / 2;
  const radius = center - tune.dot * 1.6;
  const tilt = viewTilt[state];
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const dots: Dot[] = [];
  const emit: Emit = ([x, y, z], alpha, hot, scale = 1) => {
    const ty = y * cosTilt - z * sinTilt;
    const tz = y * sinTilt + z * cosTilt;
    const depth = Math.min(1, Math.max(0, (tz + 1) / 2));
    const perspective = 1 + tz * 0.08;
    dots.push({
      x: center + x * radius * perspective,
      y: center - ty * radius * perspective,
      z: tz,
      radius: tune.dot * scale * (0.5 + 0.62 * depth),
      alpha: Math.min(1, alpha) * (0.2 + 0.8 * depth ** 1.1),
      hot: Math.min(1, Math.max(0, hot)),
    });
  };
  painters[state](time, tune, emit);
  dots.sort((a, b) => a.z - b.z);
  for (const dot of dots) {
    if (dot.alpha < 0.02) continue;
    const r = Math.round(ink[0] + (accent[0] - ink[0]) * dot.hot);
    const g = Math.round(ink[1] + (accent[1] - ink[1]) * dot.hot);
    const b = Math.round(ink[2] + (accent[2] - ink[2]) * dot.hot);
    context.fillStyle = `rgba(${r},${g},${b},${dot.alpha.toFixed(3)})`;
    context.beginPath();
    context.arc(dot.x, dot.y, dot.radius, 0, TAU);
    context.fill();
  }
}

const painters: Record<ThinkingOrbState, (time: number, tune: Tune, emit: Emit) => void> = {
  // Comets on three tilted orbits round a faint core.
  working(time, tune, emit) {
    const core = time * 0.3;
    for (const point of sphere(Math.round(tune.globe * 0.35))) {
      emit(scale(rotateY(point, core), 0.5), 0.3, 0, 0.75);
    }
    const orbits = [
      { incline: 1.1, node: 0.3, speed: 1.5 },
      { incline: -0.95, node: 2.4, speed: -1.15 },
      { incline: 0.2, node: 4.2, speed: 0.9 },
    ];
    const comets = tune.layers > 4 ? 3 : 2;
    const tail = Math.round(tune.ring / 4) + 1;
    const path = Math.round(tune.ring * 0.75);
    for (const orbit of orbits) {
      const place = (angle: number): Point =>
        rotateY(
          rotateX([Math.cos(angle) * 0.96, 0, Math.sin(angle) * 0.96], orbit.incline),
          orbit.node + time * 0.18,
        );
      for (let step = 0; step < path; step++) emit(place((step / path) * TAU), 0.14, 0, 0.7);
      for (let comet = 0; comet < comets; comet++) {
        const head = time * orbit.speed + (comet / comets) * TAU;
        for (let segment = 0; segment < tail; segment++) {
          const fade = 1 - segment / tail;
          emit(
            place(head - segment * 0.13 * Math.sign(orbit.speed)),
            fade ** 1.4,
            1 - segment / 2,
            segment === 0 ? 1.35 : 0.6 + 0.4 * fade,
          );
        }
      }
    }
  },

  // A globe turns while a bright meridian sweeps back and forth, leaving an afterglow.
  searching(time, tune, emit) {
    const spin = time * 0.35;
    const scan = 1.2 * Math.sin(time * 1.35);
    const direction = Math.sign(Math.cos(time * 1.35)) || 1;
    for (const point of sphere(tune.globe)) {
      const turned = rotateY(point, spin);
      const longitude = Math.atan2(turned[0], turned[2]);
      const gap = scan - longitude;
      const line = Math.exp(-((gap * 7) ** 2));
      const behind = gap * direction > 0 ? Math.exp(-gap * direction * 2.6) * 0.7 : 0;
      const glow = Math.max(line, behind);
      emit(turned, 0.32 + 0.68 * glow, glow, 1 + line * 0.45);
    }
    const steps = Math.round(tune.ring * 0.6);
    for (let step = 0; step <= steps; step++) {
      const latitude = -Math.PI / 2 + (step / steps) * Math.PI;
      emit(fromAngles(scan, latitude), 1, 1, 0.85);
    }
  },

  // Latitude bands twist in quarter turns, then click back so their markers line up.
  solving(time, tune, emit) {
    const bands = tune.layers;
    const cycle = 3.6;
    const round = Math.floor(time / cycle);
    const progress = (time % cycle) / cycle;
    const offsets = new Array<number>(bands).fill(0);
    const moving = new Array<number>(bands).fill(0);
    for (let move = 0; move < 4; move++) {
      const band = Math.floor(noise(round, move) * bands) % bands;
      const turn = (noise(round, move + 9) > 0.5 ? 1 : -1) * (Math.PI / 2);
      const local = clamp((progress - move * 0.12) / 0.12);
      offsets[band] += turn * easeInOut(local);
      if (local > 0 && local < 1) moving[band] = 1;
    }
    const back = clamp((progress - 0.56) / 0.16);
    const settle = 1 - easeOutBack(back);
    const solved = progress > 0.7 ? 1 - clamp((progress - 0.72) / 0.28) : 0;
    const spin = -0.45 + 0.12 * Math.sin(time * 0.7);
    for (let band = 0; band < bands; band++) {
      const latitude = (-0.95 + (1.9 * band) / (bands - 1)) * (Math.PI / 2) * 0.72;
      const count = Math.max(6, Math.round(tune.ring * Math.cos(latitude)));
      const offset = offsets[band] * settle;
      for (let index = 0; index < count; index++) {
        const marker = index === 0;
        const longitude = (index / count) * TAU + offset + spin;
        emit(
          fromAngles(longitude, latitude),
          marker ? 1 : 0.5 + 0.35 * moving[band],
          marker ? 0.7 + 0.3 * solved : 0.55 * moving[band],
          marker ? 1.4 + 0.4 * solved : 0.9,
        );
      }
    }
  },

  // A ribbon of rows winds round the sphere, its width and course undulating as it turns.
  composing(time, tune, emit) {
    const rows = tune.layers;
    const middle = (rows - 1) / 2;
    const gap = tune.layers > 4 ? 0.13 : 0.19;
    const count = Math.round(tune.ring * 1.35);
    const spin = time * 0.55;
    for (let row = 0; row < rows; row++) {
      const lane = row - middle;
      const heat = 1 - Math.abs(lane) / (middle + 0.5);
      for (let index = 0; index < count; index++) {
        const along = (index / count) * TAU;
        const latitude =
          0.34 * Math.sin(2 * along + time * 1.7) +
          lane * gap * (1 + 0.35 * Math.sin(3 * along - time * 1.3));
        const wave = 0.5 + 0.5 * Math.sin(along * 2 - time * 3);
        emit(
          rotateZ(fromAngles(along + spin, latitude), 0.28),
          0.45 + 0.55 * wave,
          heat ** 1.5,
          0.85 + 0.25 * heat,
        );
      }
    }
  },

  // A face-on ring that breathes and slowly changes shape, with a quieter ring inside.
  breathing(time, tune, emit) {
    const breath = 1 + 0.07 * Math.sin(time * 1.5);
    const tiltX = 0.35 * Math.sin(time * 0.45);
    const tiltY = 0.3 * Math.cos(time * 0.37);
    for (const ring of [0, 1]) {
      const count = Math.round(tune.ring * (ring ? 0.8 : 1.3));
      for (let index = 0; index < count; index++) {
        const angle = (index / count) * TAU;
        const reach =
          (0.86 +
            0.07 * Math.sin(3 * angle + time * 0.9 + ring) +
            0.05 * Math.sin(2 * angle - time * 0.7)) *
          breath *
          (ring ? 0.56 : 1);
        const point = rotateY(
          rotateX([Math.cos(angle) * reach, Math.sin(angle) * reach, 0], tiltX),
          tiltY,
        );
        const glow = (0.5 + 0.5 * Math.cos(angle - time * 0.8)) ** 3;
        emit(point, (ring ? 0.55 : 1) * (0.55 + 0.45 * glow), glow, ring ? 0.8 : 1);
      }
    }
  },

  // Nodes on a turning globe wire themselves together, then packets run along the links.
  connecting(time, tune, emit) {
    const { nodes, edges } = constellation(tune.layers + 2, tune.layers > 4 ? 2 : 0);
    const spin = time * 0.3;
    const cycle = 5;
    const progress = (time % cycle) / cycle;
    const fade = progress > 0.9 ? 1 - (progress - 0.9) / 0.1 : 1;
    for (const point of sphere(Math.round(tune.globe * 0.45))) {
      emit(rotateY(point, spin), 0.13, 0, 0.7);
    }
    const linked = new Set<number>();
    edges.forEach(([from, to], edge) => {
      const start = (edge / edges.length) * 0.5;
      const grown = clamp((progress - start) / 0.16);
      if (grown <= 0) return;
      const a = nodes[from];
      const b = nodes[to];
      const span = Math.acos(clamp(dot(a, b), -1, 1));
      const steps = Math.max(3, Math.round((span / Math.PI) * tune.ring));
      const drawn = Math.round(steps * grown);
      for (let step = 1; step < drawn; step++) {
        emit(rotateY(arc(a, b, step / steps), spin), 0.8 * fade, 0.25, 0.8);
      }
      if (grown < 1) {
        emit(rotateY(arc(a, b, grown), spin), fade, 1, 1.2);
        return;
      }
      linked.add(from);
      linked.add(to);
      if (progress > 0.4) {
        const run = (time * 0.85 + edge * 0.37) % 2;
        emit(rotateY(arc(a, b, run < 1 ? run : 2 - run), spin), fade, 1, 1.3);
      }
    });
    nodes.forEach((node, index) => {
      emit(rotateY(node, spin), 1, linked.has(index) ? 0.55 * fade : 0, 1.45);
    });
  },

  // Three strands plait round the sphere, passing over and under; the lead strand carries the accent.
  planning(time, tune, emit) {
    const count = Math.round(tune.ring * 1.5);
    const flow = time * 1.2;
    const spin = time * 0.45;
    for (let strand = 0; strand < 3; strand++) {
      for (let index = 0; index < count; index++) {
        const along = (index / count) * TAU;
        const phase = 3 * along - flow + (strand * TAU) / 3;
        const point = scale(
          fromAngles(along + spin, 0.42 * Math.sin(phase)),
          1 + 0.08 * Math.cos(phase),
        );
        const pulse = (0.5 + 0.5 * Math.sin(along * 2 - time * 2.4 + strand)) ** 2;
        emit(rotateZ(point, -0.35), 0.5 + 0.5 * pulse, strand === 0 ? 1 : 0, 0.9 + 0.2 * pulse);
      }
    }
  },
};

const spheres = new Map<number, Point[]>();
function sphere(count: number) {
  let points = spheres.get(count);
  if (points) return points;
  points = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index++) {
    const y = 1 - (2 * (index + 0.5)) / count;
    const ring = Math.sqrt(1 - y * y);
    points.push([Math.cos(golden * index) * ring, y, Math.sin(golden * index) * ring]);
  }
  spheres.set(count, points);
  return points;
}

const constellations = new Map<string, { nodes: Point[]; edges: [number, number][] }>();
/** Spread nodes with a nearest-neighbour spanning tree, in the order it grows, plus a few loops. */
function constellation(count: number, extra: number) {
  const key = `${count}:${extra}`;
  const cached = constellations.get(key);
  if (cached) return cached;
  const nodes = sphere(count).map((point) => rotateX(rotateY(point, 0.7), 0.5));
  const edges: [number, number][] = [];
  const joined = new Set([0]);
  while (joined.size < count) {
    let best: [number, number] = [0, 0];
    let closest = -2;
    for (const from of joined) {
      for (let to = 0; to < count; to++) {
        if (joined.has(to)) continue;
        const near = dot(nodes[from], nodes[to]);
        if (near > closest) {
          closest = near;
          best = [from, to];
        }
      }
    }
    edges.push(best);
    joined.add(best[1]);
  }
  const loops: { pair: [number, number]; near: number }[] = [];
  for (let from = 0; from < count; from++) {
    for (let to = from + 1; to < count; to++) {
      if (edges.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) continue;
      loops.push({ pair: [from, to], near: dot(nodes[from], nodes[to]) });
    }
  }
  loops.sort((a, b) => b.near - a.near);
  for (const loop of loops.slice(0, extra)) edges.push(loop.pair);
  const result = { nodes, edges };
  constellations.set(key, result);
  return result;
}

function fromAngles(longitude: number, latitude: number): Point {
  const ring = Math.cos(latitude);
  return [Math.sin(longitude) * ring, Math.sin(latitude), Math.cos(longitude) * ring];
}

function rotateX([x, y, z]: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x, y * c - z * s, y * s + z * c];
}

function rotateY([x, y, z]: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + z * s, y, -x * s + z * c];
}

function rotateZ([x, y, z]: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c, z];
}

function scale([x, y, z]: Point, factor: number): Point {
  return [x * factor, y * factor, z * factor];
}

function dot(a: Point, b: Point) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** A point along the great circle from a to b, lifted a little so links read as arcs. */
function arc(a: Point, b: Point, at: number): Point {
  const span = Math.acos(clamp(dot(a, b), -1, 1));
  const lift = 1 + 0.1 * Math.sin(Math.PI * at);
  if (span < 1e-4) return scale(a, lift);
  const wa = Math.sin((1 - at) * span) / Math.sin(span);
  const wb = Math.sin(at * span) / Math.sin(span);
  return [
    (a[0] * wa + b[0] * wb) * lift,
    (a[1] * wa + b[1] * wb) * lift,
    (a[2] * wa + b[2] * wb) * lift,
  ];
}

function clamp(value: number, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

function easeInOut(value: number) {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

function easeOutBack(value: number) {
  const overshoot = 1.9;
  return 1 + (overshoot + 1) * (value - 1) ** 3 + overshoot * (value - 1) ** 2;
}

function noise(a: number, b: number) {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

let probe: CanvasRenderingContext2D | null | undefined;
/** Resolves any colour a canvas accepts (hsl, hex, rgb) to channels; null when it cannot. */
function parseColor(value: string): Rgb | null {
  const color = value.trim();
  if (!color) return null;
  if (probe === undefined) {
    const element = document.createElement('canvas');
    element.width = 1;
    element.height = 1;
    probe = element.getContext('2d', { willReadFrequently: true });
  }
  if (!probe) return null;
  const sentinel = '#010203';
  probe.fillStyle = sentinel;
  probe.fillStyle = color;
  if (probe.fillStyle === sentinel && color.toLowerCase() !== sentinel) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return a ? [r, g, b] : null;
}
