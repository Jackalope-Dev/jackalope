import { type KeyboardEvent, useRef } from 'react';
import './resize-handle.css';

const STEP = 24;

/**
 * A focusable splitter that resizes the panel it controls by pointer drag or arrow keys.
 * `vertical` handles sit between side-by-side panels and change a width; `horizontal`
 * handles sit beneath a panel and change its height. Enter or double-click resets.
 */
export function ResizeHandle({
  orientation,
  label,
  controls,
  value,
  min,
  max,
  onResize,
  onReset,
  className,
}: {
  orientation: 'horizontal' | 'vertical';
  label: string;
  controls?: string;
  value: number;
  min: number;
  max: number;
  onResize: (size: number) => void;
  onReset: () => void;
  className?: string;
}) {
  const drag = useRef<{ start: number; value: number } | null>(null);
  const vertical = orientation === 'vertical';
  const resize = (next: number) => onResize(Math.round(Math.min(max, Math.max(min, next))));
  const onKeyDown = (event: KeyboardEvent) => {
    const actions: Record<string, () => void> = {
      [vertical ? 'ArrowLeft' : 'ArrowUp']: () => resize(value - STEP),
      [vertical ? 'ArrowRight' : 'ArrowDown']: () => resize(value + STEP),
      Home: () => resize(min),
      End: () => resize(max),
      Enter: onReset,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take focus or be dragged.
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      title="Drag to resize · double-click to reset"
      tabIndex={0}
      className={['resize-handle', className].filter(Boolean).join(' ')}
      data-orientation={orientation}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { start: vertical ? event.clientX : event.clientY, value };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start) resize(start.value + (vertical ? event.clientX : event.clientY) - start.start);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}
