import type { Rgb } from './landing-motion';

/** One triangle that covers the screen. */
const VERTEX_SHADER = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

/**
 * Domain-warped noise: sample fractal noise, use the result to offset the next sample,
 * and repeat. The fine lines come from taking bands of the final value.
 */
const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 resolution;
uniform vec2 pointer;
uniform float time;
uniform float warp;
uniform float wash;
uniform vec3 washColor;
uniform vec3 colorA;
uniform vec3 colorB;
uniform vec3 colorC;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    sum += amplitude * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return sum;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * resolution) / resolution.y;

  // Bend the field around the pointer.
  vec2 toPointer = uv - pointer;
  uv += toPointer * 0.35 * exp(-dot(toPointer, toPointer) * 5.0);

  vec2 q = vec2(fbm(uv * 1.3 + time * 0.06), fbm(uv * 1.3 + vec2(5.2, 1.3) - time * 0.05));
  vec2 w = vec2(fbm(uv * 1.1 + 3.0 * q + time * 0.04), fbm(uv * 1.1 + 3.0 * q + vec2(8.3, 2.8)));
  float field = fbm(uv + warp * w);

  float band = abs(fract(field * 11.0 + time * 0.08) - 0.5) * 2.0;
  vec3 color = mix(colorA, colorB, smoothstep(0.25, 0.75, field));
  color = mix(color, colorC, smoothstep(0.45, 1.05, length(w)) * 0.7);
  color *= 0.7 + 0.3 * smoothstep(0.0, 0.2, band);
  color += smoothstep(0.9, 1.0, band) * 0.16;

  gl_FragColor = vec4(mix(color, washColor, wash), 1.0);
}`;

interface FluidFrame {
  /** Seconds. Drives the flow. */
  time: number;
  /** Pointer position in the shader's coordinates (origin at center, y up). */
  pointer: readonly [number, number];
  /** How strongly the field folds over itself. About 3.4 at rest; higher looks more turbulent. */
  warp: number;
  /** How far the field fades toward `washColor`, 0 to 1. Text on the field needs it high. */
  wash: number;
  washColor: Rgb;
  colors: readonly [Rgb, Rgb, Rgb];
}

export interface Fluid {
  draw(frame: FluidFrame): void;
  resize(): void;
  /**
   * False when the device cannot run the shader smoothly (no GPU acceleration, or frames
   * stay slow at the lowest quality). The caller then draws only when something changes.
   */
  readonly canAnimate: boolean;
}

const UNIFORMS = [
  'resolution',
  'pointer',
  'time',
  'warp',
  'wash',
  'washColor',
  'colorA',
  'colorB',
  'colorC',
] as const;
type UniformName = (typeof UNIFORMS)[number];

/**
 * Canvas pixels per CSS pixel. The field is soft, so it starts well below native
 * resolution and only sharpens on devices that have frame time to spare.
 */
const START_SCALE = 0.5;
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.25;
/** Average frame times (ms) that raise or lower quality, or give up on animating. */
const FAST_FRAME_MS = 19;
const SLOW_FRAME_MS = 26;
const TOO_SLOW_FRAME_MS = 45;
const FRAMES_PER_MEASUREMENT = 20;

/**
 * Draws the background field into `canvas`. Returns null when WebGL is not available;
 * the page then keeps its CSS gradient.
 */
export function createFluid(canvas: HTMLCanvasElement): Fluid | null {
  const gl = canvas.getContext('webgl', {
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;

  const program = linkProgram(gl);
  if (!program) return null;
  // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL call, not a React hook.
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniform = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<UniformName, WebGLUniformLocation | null>;

  const maxScale = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
  let canAnimate = !isSoftwareRenderer(gl);
  let renderScale = canAnimate ? Math.min(START_SCALE, maxScale) : MIN_SCALE;
  let measuredFrames = 0;
  let measuredMs = 0;
  let lastDraw = 0;

  function resize() {
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * renderScale));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * renderScale));
    gl?.viewport(0, 0, canvas.width, canvas.height);
  }

  function setScale(scale: number) {
    renderScale = Math.min(maxScale, Math.max(MIN_SCALE, scale));
    resize();
  }

  /** Every few frames, trade resolution for frame rate in whichever direction is needed. */
  function adaptQuality(now: number) {
    // A long gap means the tab was hidden or the loop paused, not that a frame was slow.
    if (lastDraw > 0 && now - lastDraw < 500) {
      measuredMs += now - lastDraw;
      measuredFrames += 1;
    }
    lastDraw = now;
    if (measuredFrames < FRAMES_PER_MEASUREMENT) return;

    const average = measuredMs / measuredFrames;
    measuredFrames = 0;
    measuredMs = 0;
    if (average > TOO_SLOW_FRAME_MS && renderScale <= MIN_SCALE) canAnimate = false;
    else if (average > SLOW_FRAME_MS) setScale(renderScale * 0.7);
    else if (average < FAST_FRAME_MS && renderScale < maxScale) setScale(renderScale * 1.25);
  }

  resize();

  return {
    resize,
    get canAnimate() {
      return canAnimate;
    },
    draw(frame) {
      if (gl.isContextLost()) return;
      if (canAnimate) adaptQuality(performance.now());
      gl.uniform2f(uniform.resolution, canvas.width, canvas.height);
      gl.uniform2f(uniform.pointer, frame.pointer[0], frame.pointer[1]);
      gl.uniform1f(uniform.time, frame.time);
      gl.uniform1f(uniform.warp, frame.warp);
      gl.uniform1f(uniform.wash, frame.wash);
      gl.uniform3fv(uniform.washColor, frame.washColor);
      gl.uniform3fv(uniform.colorA, frame.colors[0]);
      gl.uniform3fv(uniform.colorB, frame.colors[1]);
      gl.uniform3fv(uniform.colorC, frame.colors[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/** True when WebGL is emulated on the CPU, where a full-screen shader would stall the page. */
function isSoftwareRenderer(gl: WebGLRenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
}

function linkProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX_SHADER],
    [gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Shader failed to compile:', gl.getShaderInfoLog(shader));
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}
