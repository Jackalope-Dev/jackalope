import type { CSSProperties } from 'react';

const BARS = 28;

/**
 * A row of bars that fills from the left as `progress` (0 to 1) grows. While
 * `active` the bars ripple; once `settled` they rest in a calm wave. Motion stops
 * under reduced motion and progress still reads from the fill.
 */
export function VoiceWave({
  progress,
  active,
  settled,
}: {
  progress: number;
  active: boolean;
  settled?: boolean;
}) {
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * BARS);
  return (
    <div
      className="voice-wave"
      data-active={active || undefined}
      data-settled={settled || undefined}
      aria-hidden="true"
    >
      {Array.from({ length: BARS }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the bars are fixed positions
          key={index}
          data-filled={index < filled || undefined}
          style={
            {
              '--i': index,
              '--h': (0.3 + 0.7 * Math.abs(Math.sin((index + 1) * 0.42))).toFixed(2),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
