import { Check } from 'lucide-react';
import { type PointerEvent, useEffect, useId, useState } from 'react';
import { hexToHsl, hslToHex, PRESET_THEMES, type ThemePalette } from '../../lib/theme-engine';

export function ThemeEditor({
  value,
  onChange,
}: {
  value: ThemePalette;
  onChange: (theme: ThemePalette) => void;
}) {
  const [hex, setHex] = useState(value.accentHex);
  const inputId = useId();
  useEffect(() => setHex(value.accentHex), [value.accentHex]);
  const validHex = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex);

  const custom = (hue: number, saturation: number, light = value.accentLight) => {
    onChange({
      ...value,
      id: 'custom',
      name: 'Your palette',
      accentHue: hue,
      accentSat: saturation,
      accentLight: light,
      accentHex: hslToHex(hue, saturation, light),
    });
  };
  const moveColor = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const hue = Math.round(
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 360,
    );
    const saturation = Math.round(
      100 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 80,
    );
    custom(hue, saturation);
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between text-xs mb-3">
          <span className="font-medium">{value.name}</span>
          <span className="text-[var(--color-text-muted)]">Make a little space for color.</span>
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Color field"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={value.accentHue}
          aria-valuetext={`Hue ${value.accentHue} degrees, saturation ${value.accentSat} percent`}
          aria-describedby={`${inputId}-help`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            moveColor(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) moveColor(event);
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 1;
            if (
              ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
            ) {
              event.preventDefault();
              const hue =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 360
                    : Math.max(
                        0,
                        Math.min(
                          360,
                          value.accentHue +
                            (event.key === 'ArrowRight'
                              ? step
                              : event.key === 'ArrowLeft'
                                ? -step
                                : 0),
                        ),
                      );
              const saturation = Math.max(
                20,
                Math.min(
                  100,
                  value.accentSat +
                    (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
                ),
              );
              custom(hue, saturation);
            }
          }}
          className="color-field relative h-44 rounded-[20px] cursor-crosshair touch-none"
          style={{
            background:
              'linear-gradient(to top, var(--color-surface-elevated), transparent), var(--color-spectrum)',
          }}
        >
          <span
            className="absolute size-5 rounded-full border-[3px] border-[var(--color-text-primary)] shadow-lg pointer-events-none -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${value.accentHue / 3.6}%`,
              top: `${(100 - Math.max(20, value.accentSat)) / 0.8}%`,
              background: value.accentHex,
            }}
          />
        </div>
        <p id={`${inputId}-help`} className="sr-only">
          Drag to explore. Left and right change hue; up and down change saturation. Hold Shift for
          larger steps.
        </p>
      </div>
      <fieldset
        className="flex items-center justify-between gap-2 border-0 p-0 m-0"
        aria-label="Theme presets"
      >
        {PRESET_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            onClick={() => onChange({ ...theme, atmosphere: value.atmosphere })}
            aria-label={theme.name}
            aria-pressed={value.id === theme.id}
            title={theme.name}
            className="theme-swatch size-9 rounded-full flex items-center justify-center transition-transform hover:scale-110"
            style={{
              background: `linear-gradient(140deg, hsl(${theme.accentHue} ${theme.accentSat}% 80%), ${theme.accentHex})`,
            }}
          >
            {value.id === theme.id && (
              <Check aria-hidden="true" className="size-4 text-[var(--color-surface-sunken)]" />
            )}
          </button>
        ))}
      </fieldset>
      <label className="block text-xs space-y-2">
        <span className="flex justify-between">
          <span>Atmosphere</span>
          <span className="text-[var(--color-text-muted)]">
            {(value.atmosphere ?? 12) < 14 ? 'Quiet' : 'Immersive'}
          </span>
        </span>
        <input
          aria-label="Atmosphere"
          type="range"
          min="0"
          max="32"
          value={value.atmosphere ?? 12}
          onChange={(event) => onChange({ ...value, atmosphere: Number(event.target.value) })}
          className="theme-range w-full"
        />
      </label>
      <div className="flex justify-between items-center text-xs">
        <label htmlFor={inputId} className="text-[var(--color-text-secondary)]">
          Exact color
        </label>
        <input
          id={inputId}
          aria-invalid={!validHex}
          value={hex}
          spellCheck={false}
          maxLength={7}
          onChange={(event) => {
            const next = event.target.value;
            setHex(next);
            if (/^#[\da-f]{6}$/i.test(next)) {
              const { h, s, l } = hexToHsl(next);
              custom(h, s, l);
            }
          }}
          onBlur={() => {
            if (validHex) {
              const { h, s, l } = hexToHsl(hex);
              custom(h, s, l);
            } else setHex(value.accentHex);
          }}
          className="w-24 rounded-lg bg-[var(--color-surface-sunken)] px-3 py-2 text-center font-mono text-[var(--color-text-primary)]"
        />
      </div>
    </div>
  );
}
