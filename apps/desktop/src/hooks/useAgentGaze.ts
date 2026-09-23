import type { AgentGaze } from '@jackalope/brand/agent-character';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

interface UseAgentGazeOptions {
  text?: string;
  isFocused?: boolean;
  disabled?: boolean;
}

const IDLE_GAZE: AgentGaze = { x: 0, y: 0 };

export function useAgentGaze(
  targetRef: RefObject<HTMLElement | null>,
  options: UseAgentGazeOptions = {},
): AgentGaze {
  const { text = '', isFocused = false, disabled = false } = options;
  const [gaze, setGaze] = useState<AgentGaze>(IDLE_GAZE);
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const calculateGaze = useCallback((): AgentGaze => {
    if (disabled) return IDLE_GAZE;

    // 1. Calculate mouse gaze component (-1 to 1)
    let mouseX = 0;
    let mouseY = 0;
    if (targetRef.current && pointerPosRef.current) {
      const rect = targetRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = pointerPosRef.current.x - centerX;
      const dy = pointerPosRef.current.y - centerY;
      const dist = Math.hypot(dx, dy);

      if (dist > 2) {
        // Smooth saturation curve up to 320px
        const intensity = Math.min(1, Math.tanh(dist / 320));
        const angle = Math.atan2(dy, dx);
        mouseX = Math.cos(angle) * intensity;
        mouseY = Math.sin(angle) * intensity;
      }
    }

    // 2. Calculate typing / focus gaze component
    if (isFocused) {
      const lines = text.split('\n');
      const currentLine = lines[lines.length - 1] ?? '';
      // Sweep across current line (~32 chars typical line width in composer)
      const lineProgress = currentLine.length === 0 ? 0.5 : Math.min(1, currentLine.length / 32);
      // Scan from -0.8 (left edge of composer) to +0.8 (right edge of composer)
      const textScanX = (lineProgress - 0.5) * 1.6;

      // Responsive micro-nod on every keystroke
      const keystrokePulse = text.length > 0 ? (text.length % 2 === 0 ? 0.08 : -0.05) : 0;
      // Look distinctly down towards the composer box
      const lookDownY = 0.88 + keystrokePulse;

      // Blend: predominantly focus on text/composer (75%), with subtle mouse glance (25%)
      const blendedX = Math.max(-1, Math.min(1, textScanX * 0.75 + mouseX * 0.25));
      const blendedY = Math.max(-1, Math.min(1, lookDownY * 0.78 + mouseY * 0.22));

      return {
        x: Number(blendedX.toFixed(2)),
        y: Number(blendedY.toFixed(2)),
      };
    }

    // When not focused: track mouse directly
    return {
      x: Number(mouseX.toFixed(2)),
      y: Number(mouseY.toFixed(2)),
    };
  }, [disabled, isFocused, text, targetRef]);

  // Update immediately when text or focus changes
  useEffect(() => {
    if (disabled) {
      setGaze(IDLE_GAZE);
      return;
    }
    const next = calculateGaze();
    setGaze((prev) =>
      Math.abs(prev.x - next.x) < 0.02 && Math.abs(prev.y - next.y) < 0.02 ? prev : next,
    );
  }, [calculateGaze, disabled]);

  // Pointer listener for mouse following
  useEffect(() => {
    if (disabled) return;

    const onPointerMove = (event: PointerEvent) => {
      pointerPosRef.current = { x: event.clientX, y: event.clientY };

      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const next = calculateGaze();
        setGaze((prev) =>
          Math.abs(prev.x - next.x) < 0.02 && Math.abs(prev.y - next.y) < 0.02 ? prev : next,
        );
      });
    };

    const onPointerLeave = () => {
      pointerPosRef.current = null;
      if (!isFocused) {
        setGaze(IDLE_GAZE);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [calculateGaze, disabled, isFocused]);

  return disabled ? IDLE_GAZE : gaze;
}
