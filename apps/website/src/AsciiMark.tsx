import { characterPaths } from '@jackalope/brand/character';
import { useEffect, useRef } from 'react';

const RAMP = ' .:-=+*#%@';
const NOISE = '01<>/\\{}[]#$%&*+=?';
const MARK = [
  characterPaths.farEar,
  characterPaths.nearEar,
  characterPaths.antler,
  characterPaths.head,
];
const VIEW = { x: 38, y: 4, width: 105, height: 117 };
const ECHO = { x: 4, y: 1 };
const INTRO_MS = 1600;
const FRAME_MS = 1000 / 30;

/**
 * The Jackalope mark drawn as text, like the terminal draws it: a solid head with outlined
 * echoes trailing right. It decodes from noise when first seen, shimmers while visible and
 * scrambles around the pointer. Reduced motion draws one still frame.
 */
export function AsciiMark({
  className = '',
  echoes = 6,
  interactive = true,
}: {
  className?: string;
  echoes?: number;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const paths = MARK.map((d) => new Path2D(d));
    const sampler = document.createElement('canvas').getContext('2d', {
      willReadFrequently: true,
    });
    let cols = 0;
    let rows = 0;
    let cellWidth = 0;
    let cellHeight = 0;
    let levels = new Float32Array(0);
    let seeds = new Float32Array(0);
    let ink = '';
    let accent = '';
    let introStart = -1;
    let visible = false;
    let frame = 0;
    let last = 0;
    let pointer: { x: number; y: number } | null = null;

    const readColors = () => {
      const style = getComputedStyle(canvas);
      ink = style.color;
      accent = style.getPropertyValue('--lp-ascii-accent').trim() || ink;
    };

    const measure = () => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height || !sampler) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(box.width * ratio);
      canvas.height = Math.round(box.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const size = Math.max(7, Math.min(13, box.width / 62));
      cellWidth = size * 0.62;
      cellHeight = size * 1.05;
      cols = Math.floor(box.width / cellWidth);
      rows = Math.floor(box.height / cellHeight);
      context.font = `500 ${size}px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`;
      context.textBaseline = 'top';

      // Rasterize the mark at one pixel per cell, then read coverage as brightness.
      const spanX = VIEW.width + ECHO.x * echoes;
      const spanY = VIEW.height + ECHO.y * echoes;
      const scale = Math.min(box.width / spanX, box.height / spanY) * 0.94;
      const offsetX = (box.width - spanX * scale) / 2;
      const offsetY = (box.height - spanY * scale) / 2;
      sampler.canvas.width = cols;
      sampler.canvas.height = rows;
      sampler.clearRect(0, 0, cols, rows);
      const place = (shift: number) =>
        sampler.setTransform(
          scale / cellWidth,
          0,
          0,
          scale / cellHeight,
          (offsetX + (ECHO.x * shift - VIEW.x) * scale) / cellWidth,
          (offsetY + (ECHO.y * shift - VIEW.y) * scale) / cellHeight,
        );
      sampler.lineWidth = 1.6;
      for (let echo = echoes; echo >= 1; echo--) {
        place(echo);
        sampler.strokeStyle = `rgba(0,0,0,${0.55 - (echo / echoes) * 0.4})`;
        for (const path of paths) sampler.stroke(path);
      }
      place(0);
      sampler.fillStyle = '#000';
      for (const path of paths) sampler.fill(path);
      const data = sampler.getImageData(0, 0, cols, rows).data;
      levels = new Float32Array(cols * rows);
      seeds = new Float32Array(cols * rows);
      for (let index = 0; index < levels.length; index++) {
        levels[index] = data[index * 4 + 3] / 255;
        seeds[index] = Math.random();
      }
      readColors();
    };

    const draw = (now: number) => {
      const box = canvas.getBoundingClientRect();
      context.clearRect(0, 0, box.width, box.height);
      const still = reduce.matches;
      const intro = still ? 1 : introStart < 0 ? 0 : Math.min(1, (now - introStart) / INTRO_MS);
      const reach = Math.max(60, box.width * 0.12);
      const accented: [string, number, number, number][] = [];
      context.fillStyle = ink;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = row * cols + col;
          const level = levels[index];
          if (level < 0.06) continue;
          const x = col * cellWidth;
          const y = row * cellHeight;
          let glyph = RAMP[Math.min(RAMP.length - 1, Math.ceil(level * (RAMP.length - 1)))];
          let alpha = 0.22 + level * 0.78;
          if (seeds[index] > intro) {
            glyph = NOISE[Math.floor(Math.random() * NOISE.length)];
            alpha *= 0.35;
          } else if (!still && Math.random() < 0.004) {
            glyph = NOISE[Math.floor(Math.random() * NOISE.length)];
          }
          if (pointer && !still) {
            const distance = Math.hypot(x - pointer.x, y - pointer.y);
            if (distance < reach) {
              const pull = 1 - distance / reach;
              if (Math.random() < pull * 0.7) {
                accented.push([NOISE[Math.floor(Math.random() * NOISE.length)], x, y, pull]);
                continue;
              }
            }
          }
          context.globalAlpha = alpha;
          context.fillText(glyph, x, y);
        }
      }
      context.fillStyle = accent;
      for (const [glyph, x, y, pull] of accented) {
        context.globalAlpha = 0.4 + pull * 0.6;
        context.fillText(glyph, x, y);
      }
      context.globalAlpha = 1;
    };

    const loop = (now: number) => {
      frame = 0;
      if (!visible || reduce.matches) return;
      if (now - last >= FRAME_MS) {
        last = now;
        draw(now);
      }
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (frame || !visible) return;
      if (reduce.matches) {
        draw(performance.now());
        return;
      }
      if (introStart < 0) introStart = performance.now();
      frame = requestAnimationFrame(loop);
    };

    const resize = new ResizeObserver(() => {
      measure();
      draw(performance.now());
    });
    resize.observe(canvas);
    const view = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    view.observe(canvas);
    // Appearance changes rewrite the root's inline tokens; pick up the new ink.
    const theme = new MutationObserver(() => {
      readColors();
      draw(performance.now());
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const box = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const leave = () => {
      pointer = null;
    };
    if (interactive) {
      window.addEventListener('pointermove', move, { passive: true });
      document.addEventListener('pointerleave', leave);
    }
    const motion = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      start();
    };
    reduce.addEventListener('change', motion);
    canvas.dataset.ready = 'true';
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      view.disconnect();
      theme.disconnect();
      reduce.removeEventListener('change', motion);
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', leave);
    };
  }, [echoes, interactive]);
  return (
    <span className={`lp-ascii-frame ${className}`} aria-hidden="true">
      <canvas ref={ref} className="lp-ascii" />
    </span>
  );
}
