/**
 * How the dragged agent hangs from the pointer: it trails a little behind, swings like a
 * pendulum into the direction of travel, squashes on sharp turns and settles with a
 * short wobble. Positions go in with `push`; `step` runs once per animation frame and
 * returns the pose to draw. Springs are tuned to be snappy rather than floaty.
 */
export interface GlobPose {
  /** Trailing offset from the grip point, in CSS pixels. */
  x: number;
  y: number;
  /** Swing in degrees; positive leans right. */
  angle: number;
  scaleX: number;
  scaleY: number;
  /** Pointer speed in CSS pixels per millisecond. */
  speed: number;
  /** Unit direction of travel; zero when still. */
  dirX: number;
  dirY: number;
}

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/** One spring step: returns the new value and velocity. */
function spring(
  value: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
) {
  const next = velocity + (target - value) * stiffness - velocity * damping;
  return [value + next, next] as const;
}

export class GlobMotion {
  private last: { x: number; y: number; at: number } | null = null;
  private vx = 0;
  private vy = 0;
  private previous = { vx: 0, vy: 0 };
  private lag = { x: 0, vx: 0, y: 0, vy: 0 };
  private swing = { angle: 0, velocity: 0 };
  private squash = { value: 0, velocity: 0 };

  /** Records where the grip point is now. */
  push(x: number, y: number, at = performance.now()) {
    if (this.last) {
      const dt = Math.max(8, at - this.last.at);
      // Smoothed so one jittery sample doesn't jerk the swing.
      this.vx = this.vx * 0.55 + ((x - this.last.x) / dt) * 0.45;
      this.vy = this.vy * 0.55 + ((y - this.last.y) / dt) * 0.45;
    }
    this.last = { x, y, at };
  }

  reset() {
    this.last = null;
    this.vx = this.vy = 0;
    this.previous = { vx: 0, vy: 0 };
    this.lag = { x: 0, vx: 0, y: 0, vy: 0 };
    this.swing = { angle: 0, velocity: 0 };
    this.squash = { value: 0, velocity: 0 };
  }

  step(now = performance.now()): GlobPose {
    // A pointer that stopped sending positions has stopped moving.
    if (!this.last || now - this.last.at > 50) {
      this.vx *= 0.7;
      this.vy *= 0.7;
    }
    const speed = Math.hypot(this.vx, this.vy);
    const turn = Math.hypot(this.vx - this.previous.vx, this.vy - this.previous.vy);
    this.previous = { vx: this.vx, vy: this.vy };
    [this.lag.x, this.lag.vx] = spring(this.lag.x, this.lag.vx, clamp(-this.vx * 14, 16), 0.2, 0.5);
    [this.lag.y, this.lag.vy] = spring(this.lag.y, this.lag.vy, clamp(-this.vy * 14, 16), 0.2, 0.5);
    // Underdamped, so the swing overshoots once and settles: the wobble when it stops.
    [this.swing.angle, this.swing.velocity] = spring(
      this.swing.angle,
      this.swing.velocity,
      clamp(-this.vx * 24, 28),
      0.13,
      0.3,
    );
    [this.squash.value, this.squash.velocity] = spring(
      this.squash.value,
      this.squash.velocity,
      Math.min(0.24, turn * 4 + speed * 0.04),
      0.28,
      0.42,
    );
    const squash = Math.max(-0.08, this.squash.value);
    return {
      x: this.lag.x,
      y: this.lag.y,
      angle: this.swing.angle,
      scaleX: 1 + squash,
      scaleY: 1 - squash * 0.8,
      speed,
      dirX: speed > 0.02 ? this.vx / speed : 0,
      dirY: speed > 0.02 ? this.vy / speed : 0,
    };
  }
}

export const prefersReducedMotion = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
