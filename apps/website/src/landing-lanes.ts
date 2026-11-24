import { LANE_SWAY, type LaneField, type Rgb } from './landing-motion';

/** One triangle that covers the screen. */
const VERTEX_SHADER = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

/**
 * Draws every lane as a thin line with beads of work travelling down it. The lane
 * positions repeat `laneOpen` and `laneX` from ./landing-motion, which place the page's
 * own elements on the same lines; change them together.
 */
const fragmentShader = (lanes: number) => `
precision highp float;
#define LANES ${lanes}

uniform vec2 resolution;
uniform float scroll;
uniform float time;
uniform float center;
uniform float spread;
uniform float rootY;
uniform float forkEnd;
uniform float mergeStart;
uniform float mergeEnd;
uniform float reveal;
uniform float intensity;
uniform float glow;
uniform vec3 background;
uniform vec3 trunk;
uniform vec3 lanes[LANES];

float disc(vec2 offset, float radius, float pixel) {
  return 1.0 - smoothstep(radius, radius + 1.5 * pixel, length(offset));
}

void main() {
  float pixel = 1.0 / resolution.y;
  float x = (gl_FragCoord.x - 0.5 * resolution.x) * pixel;
  float y = scroll + 1.0 - gl_FragCoord.y * pixel;
  float endY = mergeEnd + 0.12;

  float open = smoothstep(rootY, forkEnd, y) * (1.0 - smoothstep(mergeStart, mergeEnd, y));
  float drawn = 1.0 - smoothstep(reveal - 0.08, reveal, y);
  float alive = step(rootY, y) * step(y, endY) * drawn * intensity;
  float halfWidth = max(1.1 * pixel, 0.0016);

  vec3 color = background;
  for (int i = 0; i < LANES; i++) {
    float lane = float(i);
    float gaps = float(LANES - 1);
    float sway = ${LANE_SWAY} / gaps * sin(y * 2.3 + lane * 1.7 + time * 0.4);
    float away = abs(x - (center + (lane / gaps - 0.5 + sway) * spread * open));

    float line = 1.0 - smoothstep(halfWidth, halfWidth + 1.5 * pixel, away);
    float along = fract(y * 1.4 - time * (0.07 + 0.013 * lane) + lane * 0.37) - 0.5;
    float bead = disc(vec2(away, along / 1.4), 0.0055, pixel) * open;

    vec3 tint = mix(trunk, lanes[i], open);
    color = mix(color, tint, max(line, bead) * alive);
    color += tint * exp(-away * away * 9000.0) * glow * alive * mix(0.05, 0.3, open);
  }

  // A ring where the line starts and another where the merged line ends.
  vec2 root = vec2(x - center, y - rootY);
  vec2 end = vec2(x - center, y - endY);
  float rings = max(disc(root, 0.012, pixel), disc(end, 0.012, pixel) * drawn);
  float holes = max(disc(root, 0.006, pixel), disc(end, 0.006, pixel) * drawn);
  color = mix(color, trunk, rings * intensity);
  color = mix(color, background, holes * intensity);

  gl_FragColor = vec4(color, 1.0);
}`;

interface LanesFrame extends LaneField {
  /** Page height at the top of the screen, in viewport heights. */
  scroll: number;
  /** Seconds. Sways the lanes and moves the beads. */
  time: number;
  /** Lanes are drawn only above this page height, which lets them grow in on load. */
  reveal: number;
  /** How strongly the lanes show against the page, 0 to 1. Lower behind text. */
  intensity: number;
  /** Extra light around each lane. For dark pages only. */
  glow: number;
  background: Rgb;
  /** Color of the line while the lanes are merged. */
  trunk: Rgb;
}

export interface Lanes {
  draw(frame: LanesFrame): void;
  resize(): void;
  /**
   * False when the device cannot run the shader smoothly (no GPU acceleration, or frames
   * stay slow at the lowest quality). The caller then draws only when something changes.
   */
  readonly canAnimate: boolean;
}

const UNIFORMS = [
  'resolution',
  'scroll',
  'time',
  'center',
  'spread',
  'rootY',
  'forkEnd',
  'mergeStart',
  'mergeEnd',
  'reveal',
  'intensity',
  'glow',
  'background',
  'trunk',
  'lanes',
] as const;
type UniformName = (typeof UNIFORMS)[number];

/** Canvas pixels per CSS pixel. The lines are thin, so they start at native resolution. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
/** Average frame times (ms) that raise or lower quality, or give up on animating. */
const FAST_FRAME_MS = 19;
const SLOW_FRAME_MS = 26;
const TOO_SLOW_FRAME_MS = 45;
const FRAMES_PER_MEASUREMENT = 20;

/**
 * Draws one lane per color into `canvas`. Returns null when WebGL is not available; the
 * page then shows its plain background.
 */
export function createLanes(canvas: HTMLCanvasElement, colors: Rgb[]): Lanes | null {
  const gl = canvas.getContext('webgl', {
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;

  const program = linkProgram(gl, fragmentShader(colors.length));
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
  gl.uniform3fv(uniform.lanes, new Float32Array(colors.flat()));

  const maxScale = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
  let canAnimate = !isSoftwareRenderer(gl);
  let renderScale = canAnimate ? maxScale : Math.min(1, maxScale);
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
      gl.uniform1f(uniform.scroll, frame.scroll);
      gl.uniform1f(uniform.time, frame.time);
      gl.uniform1f(uniform.center, frame.center);
      gl.uniform1f(uniform.spread, frame.spread);
      gl.uniform1f(uniform.rootY, frame.rootY);
      gl.uniform1f(uniform.forkEnd, frame.forkEnd);
      gl.uniform1f(uniform.mergeStart, frame.mergeStart);
      gl.uniform1f(uniform.mergeEnd, frame.mergeEnd);
      gl.uniform1f(uniform.reveal, frame.reveal);
      gl.uniform1f(uniform.intensity, frame.intensity);
      gl.uniform1f(uniform.glow, frame.glow);
      gl.uniform3fv(uniform.background, frame.background);
      gl.uniform3fv(uniform.trunk, frame.trunk);
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

function linkProgram(gl: WebGLRenderingContext, fragment: string): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX_SHADER],
    [gl.FRAGMENT_SHADER, fragment],
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
