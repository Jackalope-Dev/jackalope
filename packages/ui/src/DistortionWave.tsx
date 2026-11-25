import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import './distortion-wave.css';

export type DistortionWaveType = 'vertical' | 'horizontal' | 'center';

type WaveSource = Element | DOMRect | null | undefined;

export interface DistortionWaveOptions {
  /** Where the front opens from. Defaults to the control last pressed inside `within`. */
  source?: WaveSource;
  /** The view the wave passes over; the layer is clipped to its box and corners. */
  within: Element;
  type?: DistortionWaveType;
  /** Collapses the front back into the source instead of opening it. */
  reverse?: boolean;
  /** Called once the front has crossed about half the view; swap views here. */
  onMidpoint?: () => void;
  onFinish?: () => void;
}

export interface DistortionWaveHandle {
  cancel: () => void;
}

const DURATION: Record<DistortionWaveType, number> = {
  vertical: 850,
  horizontal: 850,
  center: 780,
};
// How far the front reaches along each axis: a wide, shallow front rises from a button at the
// bottom and spans the width quickly; a horizontal one sweeps across from a tall source.
const METRIC: Record<DistortionWaveType, [number, number]> = {
  vertical: [0.42, 1],
  horizontal: [1, 0.42],
  center: [1, 1],
};

let pressed: Element | null = null;
let tracking = false;

function trackPresses() {
  if (tracking || typeof document === 'undefined') return;
  tracking = true;
  document.addEventListener(
    'pointerdown',
    (event) => {
      pressed =
        event.target instanceof Element ? event.target.closest('button, [role="button"], a') : null;
    },
    true,
  );
  // A keyboard send has no pressed control, so the source falls back to the view.
  document.addEventListener(
    'keydown',
    () => {
      pressed = null;
    },
    true,
  );
}
trackPresses();

/** The control last pressed with a pointer, cleared by any key press. */
export function lastPressedControl(): Element | null {
  return pressed?.isConnected ? pressed : null;
}

function reducedMotion() {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

type Rgb = [number, number, number];

// Colours can be any syntax (tokens, oklch, color-mix…); a 2D canvas normalises whatever the
// engine parses to sRGB bytes. An expression the engine rejects keeps the previous colour.
function resolveColors(within: Element, colors: string[]): Rgb[] {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  within.appendChild(probe);
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const resolved = colors.map((color): Rgb => {
    probe.style.color = color;
    const value = getComputedStyle(probe).color;
    if (!context) return [128, 128, 128];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = '#808080';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  });
  probe.remove();
  return resolved;
}

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uDpr;
uniform vec2 uSource;
uniform vec2 uSourceSize;
uniform vec2 uMetric;
uniform float uRadius;
uniform float uBand;
uniform float uProgress;
uniform float uTime;
uniform float uDark;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return noise(p) * 0.65 + noise(p * 2.03 + 7.1) * 0.35; }
// x is how far behind the front a point sits: a quick rise at the front, a long soft tail.
float swellBand(float x, float w) {
  return smoothstep(-2.0, w * 0.18, x) * (1.0 - smoothstep(w * 0.18, w, x));
}
void over(inout vec3 color, inout float alpha, vec3 top, float topAlpha) {
  float next = topAlpha + alpha * (1.0 - topAlpha);
  color = (top * topAlpha + color * alpha * (1.0 - topAlpha)) / max(next, 1e-4);
  alpha = next;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 rel = p - uSource;
  // Distance from the source's box rather than its centre, so the front leaves its edge.
  vec2 q = max(abs(rel) - uSourceSize * 0.5, 0.0);
  float swell = sin(clamp(uProgress, 0.0, 1.0) * 3.14159);
  float d = length(q * uMetric) + (fbm(p * 0.011 + vec2(uTime * 0.6, -uTime * 0.4)) - 0.5) * (12.0 + 24.0 * swell);
  float x = uRadius - d;

  float shift = 4.0 + 7.0 * swell;
  float r = swellBand(x + shift, uBand);
  float g = swellBand(x, uBand);
  float b = swellBand(x - shift, uBand);
  float weight = r + g + b;
  vec3 color = (uC1 * r + uC2 * g + uC3 * b) / max(weight, 1e-4);
  float alpha = max(r, max(g, b)) * mix(0.2, 0.3, uDark);

  float passed = smoothstep(0.0, uBand * 0.6, x);
  float edgeDistance = min(min(p.x, p.y), min(uSize.x - p.x, uSize.y - p.y));
  float hue = fract(atan(rel.y, rel.x) / 6.28318 + uTime * 0.15) * 3.0;
  vec3 edgeColor = hue < 1.0 ? mix(uC1, uC2, hue) : hue < 2.0 ? mix(uC2, uC3, hue - 1.0) : mix(uC3, uC1, hue - 2.0);
  over(color, alpha, edgeColor, (1.0 - smoothstep(0.0, 26.0, edgeDistance)) * passed * 0.22);

  float pull = (1.0 - smoothstep(0.0, 0.22, uProgress)) * exp(-length(q) / 18.0);
  over(color, alpha, uC1, pull * 0.3);

  float line = exp(-abs(x) / 1.1) * smoothstep(0.18, 0.42, uProgress);
  over(color, alpha, mix(uC2, vec3(1.0), mix(0.3, 0.7, uDark)), line * 0.5);

  alpha *= 1.0 - smoothstep(0.8, 1.0, uProgress);
  outColor = vec4(color * alpha, alpha);
}`;

interface Renderer {
  element: HTMLElement;
  draw: (frame: Frame) => void;
  dispose: () => void;
}

interface Frame {
  progress: number;
  radius: number;
  time: number;
}

interface Scene {
  width: number;
  height: number;
  source: { x: number; y: number; w: number; h: number };
  metric: [number, number];
  band: number;
  colors: Rgb[];
  dark: boolean;
}

function compile(gl: WebGL2RenderingContext, type: number, text: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, text);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function glRenderer(scene: Scene): Renderer | null {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(scene.width * dpr));
  canvas.height = Math.max(1, Math.round(scene.height * dpr));
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram is not a React hook.
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  const at = (name: string) => gl.getUniformLocation(program, name);
  const { source, colors } = scene;
  gl.uniform2f(at('uSize'), scene.width, scene.height);
  gl.uniform1f(at('uDpr'), canvas.width / scene.width);
  gl.uniform2f(at('uSource'), source.x + source.w / 2, source.y + source.h / 2);
  gl.uniform2f(at('uSourceSize'), source.w, source.h);
  gl.uniform2f(at('uMetric'), ...scene.metric);
  gl.uniform1f(at('uBand'), scene.band);
  gl.uniform1f(at('uDark'), scene.dark ? 1 : 0);
  ['uC1', 'uC2', 'uC3'].forEach((name, index) => {
    const [r, g, b] = colors[index];
    gl.uniform3f(at(name), r / 255, g / 255, b / 255);
  });
  const radius = at('uRadius');
  const progress = at('uProgress');
  const time = at('uTime');
  return {
    element: canvas,
    draw(frame) {
      gl.uniform1f(radius, frame.radius);
      gl.uniform1f(progress, frame.progress);
      gl.uniform1f(time, frame.time);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

function ellipse(scene: Scene, radius: number) {
  const { source, metric } = scene;
  return {
    rx: Math.max(1, radius / metric[0] + source.w / 2),
    ry: Math.max(1, radius / metric[1] + source.h / 2),
    at: `${source.x + source.w / 2}px ${source.y + source.h / 2}px`,
  };
}

// Without WebGL 2 the swell is a gradient ring that follows the same front.
function cssRenderer(scene: Scene): Renderer {
  const element = document.createElement('div');
  const rgba = ([r, g, b]: Rgb, alpha: number) => `rgb(${r} ${g} ${b} / ${alpha})`;
  return {
    element,
    draw({ progress, radius }) {
      const { rx, ry, at } = ellipse(scene, radius);
      const span = Math.max(rx, 1);
      const behind = Math.max(0, 100 - (scene.band / span) * 100);
      const near = Math.max(0, 100 - ((scene.band * 0.2) / span) * 100);
      const [c1, c2, c3] = scene.colors;
      element.style.backgroundImage = `radial-gradient(ellipse ${rx}px ${ry}px at ${at}, transparent ${behind}%, ${rgba(c3, 0.3)} ${(behind + near) / 2}%, ${rgba(c2, 0.42)} ${near}%, ${rgba(c1, 0.5)} 99%, transparent 100%)`;
      element.style.opacity = String(1 - Math.max(0, (progress - 0.8) / 0.2));
    },
    dispose() {},
  };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

let current: { cancel: () => void } | null = null;

/**
 * Runs one colourful distortion wave over `within`, opening from `source`. The wave is drawn
 * over the live view rather than bending a picture of it, so it can cover a view that swaps or
 * unmounts underneath. Reduced motion skips the wave and only runs the callbacks.
 */
export function playDistortionWave({
  source,
  within,
  type = 'vertical',
  reverse = false,
  onMidpoint,
  onFinish,
}: DistortionWaveOptions): DistortionWaveHandle {
  current?.cancel();
  const box = within.getBoundingClientRect();
  if (
    reducedMotion() ||
    document.hidden ||
    !within.isConnected ||
    box.width < 8 ||
    box.height < 8
  ) {
    onMidpoint?.();
    onFinish?.();
    return { cancel() {} };
  }
  const control = lastPressedControl();
  const origin =
    source instanceof DOMRect
      ? source
      : (source ?? (control && within.contains(control) ? control : null))?.getBoundingClientRect();
  const from = origin ?? new DOMRect(box.left + box.width / 2, box.bottom - 24, 0, 0);
  const sourceBox = {
    x: Math.min(Math.max(from.left - box.left, 0), box.width),
    y: Math.min(Math.max(from.top - box.top, 0), box.height),
    w: Math.min(from.width, box.width),
    h: Math.min(from.height, box.height),
  };
  // The neighbouring hues match BorderBeam's, so a single-colour theme still splits into a
  // spectrum.
  const [accent, secondary, tertiary, surface] = resolveColors(within, [
    'var(--color-accent)',
    'oklch(from var(--color-accent) l c calc(h - 55))',
    'oklch(from var(--color-accent) calc(l + 0.06) c calc(h + 70))',
    'var(--color-surface)',
  ]);
  const metric = METRIC[type];
  const scene: Scene = {
    width: box.width,
    height: box.height,
    source: sourceBox,
    metric,
    band: Math.min(120, Math.max(56, Math.min(box.width, box.height) * 0.2)),
    colors: [accent, secondary, tertiary],
    dark: (0.2126 * surface[0] + 0.7152 * surface[1] + 0.0722 * surface[2]) / 255 < 0.5,
  };
  const corners = [
    [0, 0],
    [box.width, 0],
    [0, box.height],
    [box.width, box.height],
  ];
  const cx = sourceBox.x + sourceBox.w / 2;
  const cy = sourceBox.y + sourceBox.h / 2;
  const reach =
    Math.max(
      ...corners.map(([x, y]) =>
        Math.hypot(
          Math.max(Math.abs(x - cx) - sourceBox.w / 2, 0) * metric[0],
          Math.max(Math.abs(y - cy) - sourceBox.h / 2, 0) * metric[1],
        ),
      ),
    ) +
    scene.band +
    40;

  const layer = document.createElement('div');
  layer.className = 'ui-distortion-wave-layer';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    borderRadius: getComputedStyle(within).borderRadius,
  });
  const blur = document.createElement('div');
  blur.className = 'ui-distortion-wave-blur';
  const renderer = glRenderer(scene) ?? cssRenderer(scene);
  layer.append(blur, renderer.element);
  document.body.appendChild(layer);

  // A brief pull toward the source before the wave lets go of the view. The individual
  // `scale` and `translate` properties compose with any transform the view already has.
  const toward = (offset: number) => Math.max(-4, Math.min(4, offset * 0.008));
  const transformOrigin = `${cx}px ${cy}px`;
  const pull = (within as HTMLElement).animate?.(
    [
      { scale: '1', translate: '0 0', transformOrigin },
      {
        scale: '0.996',
        translate: `${toward(cx - box.width / 2)}px ${toward(cy - box.height / 2)}px`,
        transformOrigin,
        offset: 0.16,
      },
      { scale: '1', translate: '0 0', transformOrigin },
    ],
    { duration: 560, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );

  const duration = DURATION[type];
  const start = performance.now();
  let frame = 0;
  let midpoint = false;
  let done = false;
  const finish = (complete: boolean) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    pull?.cancel();
    renderer.dispose();
    layer.remove();
    if (current === handle) current = null;
    if (!midpoint) onMidpoint?.();
    if (complete || !midpoint) onFinish?.();
  };
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    const travel = ease(Math.min(1, Math.max(0, (progress - 0.08) / 0.92)));
    const radius = reach * (reverse ? 1 - travel : travel);
    renderer.draw({ progress, radius, time: (now - start) / 1000 });
    const swell = Math.sin(progress * Math.PI);
    const { rx, ry, at } = ellipse(scene, radius);
    const span = Math.max(rx, 1);
    const behind = Math.max(0, 100 - (scene.band / span) * 100);
    const near = Math.max(0, 100 - ((scene.band * 0.3) / span) * 100);
    const mask = `radial-gradient(ellipse ${rx}px ${ry}px at ${at}, transparent ${behind}%, rgb(0 0 0 / 0.55) ${(behind + near) / 2}%, #000 ${near}%, transparent 100%)`;
    blur.style.setProperty('--wave-blur', `${(0.5 + 3.5 * swell).toFixed(2)}px`);
    blur.style.setProperty('mask-image', mask);
    blur.style.setProperty('-webkit-mask-image', mask);
    if (!midpoint && progress >= 0.45) {
      midpoint = true;
      onMidpoint?.();
    }
    if (progress >= 1) finish(true);
    else frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const handle = { cancel: () => finish(false) };
  current = handle;
  return handle;
}

export interface DistortionWaveProps {
  /** Which view shows; changing it runs the wave. */
  revealed: boolean;
  /** The view that shows first. */
  children: ReactNode;
  /** The view the wave leaves behind. */
  revealedContent: ReactNode;
  /** Stays above both views, such as the button that starts the wave. */
  overlay?: ReactNode;
  type?: DistortionWaveType;
  /** Where the wave opens; defaults to the control last pressed. */
  source?: RefObject<Element | null> | Element | DOMRect | null;
  onFinish?: (revealed: boolean) => void;
  className?: string;
  style?: CSSProperties;
}

/** Swaps two views of one card under a distortion wave. */
export function DistortionWave({
  revealed,
  children,
  revealedContent,
  overlay,
  type,
  source,
  onFinish,
  className,
  style,
}: DistortionWaveProps) {
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(revealed);
  const latest = useRef({ type, source, onFinish });
  latest.current = { type, source, onFinish };
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const within = root.current;
    if (!within) return;
    const { type, source, onFinish } = latest.current;
    const from = source && 'current' in source ? source.current : source;
    const wave = playDistortionWave({
      within,
      source: from ?? undefined,
      type,
      reverse: !revealed,
      onMidpoint: () => setShown(revealed),
      onFinish: () => onFinish?.(revealed),
    });
    return wave.cancel;
  }, [revealed]);
  return (
    <div
      ref={root}
      className={['ui-distortion-wave', className].filter(Boolean).join(' ')}
      style={style}
    >
      <div className="ui-distortion-wave-view" data-shown={!shown} inert={shown || undefined}>
        {children}
      </div>
      <div className="ui-distortion-wave-view" data-shown={shown} inert={!shown || undefined}>
        {revealedContent}
      </div>
      {overlay && <div className="ui-distortion-wave-overlay">{overlay}</div>}
    </div>
  );
}
