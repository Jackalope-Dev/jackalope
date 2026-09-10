import {
  type ColorHarmony,
  hexToHsl,
  hslToHex,
  PRESET_THEMES,
  paletteColors,
  paletteGradient,
  type ThemePalette,
  themeTokens,
} from '@jackalope/brand/theme';
import { Check, Clock3, Moon, Sun } from 'lucide-react';
import { type PointerEvent, useEffect, useId, useState } from 'react';
import './theme-editor.css';

export function ThemeEditor({
  value,
  onChange,
}: {
  value: ThemePalette;
  onChange: (theme: ThemePalette) => void;
}) {
  const colors = paletteColors(value);
  const primaryHex = colors[0].hex;
  const [hex, setHex] = useState(primaryHex);
  const inputId = useId();
  useEffect(() => setHex(primaryHex), [primaryHex]);
  const validHex = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex);
  const harmony = value.harmony ?? 'single';
  const appearance =
    value.appearance === 'automatic' ? 'Auto' : value.isDark === false ? 'Light' : 'Dark';

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

  const colorField = (
    <div>
      <div className="flex items-center justify-between text-xs mb-3">
        <span className="font-medium">{value.name}</span>
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
            background: colors[0].css,
          }}
        />
        {colors.slice(1).map((color) => (
          <span
            key={color.offset}
            aria-hidden="true"
            className="theme-companion-marker"
            style={{
              left: `${color.hue / 3.6}%`,
              top: `${(100 - Math.max(20, value.accentSat)) / 0.8}%`,
              background: color.css,
            }}
          />
        ))}
      </div>
      <p id={`${inputId}-help`} className="sr-only">
        Drag to explore. Left and right change hue; up and down change saturation. Hold Shift for
        larger steps.
      </p>
    </div>
  );
  const colorControls = (
    <div className="theme-color-controls">
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
          max="64"
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
            } else setHex(primaryHex);
          }}
          className="w-24 rounded-lg bg-[var(--color-surface-sunken)] px-3 py-2 text-center font-mono text-[var(--color-text-primary)]"
        />
      </div>
    </div>
  );

  return (
    <div className="theme-editor">
      <fieldset className="appearance-mode" aria-label="Appearance">
        {[
          { dark: false, label: 'Light', Icon: Sun },
          { dark: true, label: 'Dark', Icon: Moon },
          { dark: value.isDark, label: 'Auto', Icon: Clock3 },
        ].map(({ dark, label, Icon }) => (
          <label key={label} className="appearance-mode-option">
            <input
              type="radio"
              name={`${inputId}-appearance`}
              value={label}
              checked={appearance === label}
              aria-describedby={
                label === 'Auto' && appearance === 'Auto' ? `${inputId}-schedule` : undefined
              }
              onChange={() =>
                onChange({
                  ...value,
                  isDark: dark,
                  appearance: label === 'Auto' ? 'automatic' : 'manual',
                })
              }
              className="sr-only"
            />
            <span>
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </span>
          </label>
        ))}
      </fieldset>
      {appearance === 'Auto' && (
        <p id={`${inputId}-schedule`} className="sr-only">
          Light from 7 AM to 7 PM, dark overnight. Uses your device’s local time.
        </p>
      )}
      <fieldset className="theme-harmony" aria-label="Color harmony">
        {(
          [
            { id: 'single', label: 'Single' },
            { id: 'duo', label: 'Duo' },
            { id: 'trio', label: 'Trio' },
          ] satisfies { id: ColorHarmony; label: string }[]
        ).map(({ id, label }) => (
          <label key={id} className="theme-harmony-option">
            <input
              type="radio"
              name={`${inputId}-harmony`}
              checked={harmony === id}
              onChange={() => onChange({ ...value, harmony: id })}
              aria-describedby={`${inputId}-harmony-help`}
              className="sr-only"
            />
            <span>
              <span className="theme-harmony-colors" aria-hidden="true">
                {paletteColors({ ...value, harmony: id }).map((color) => (
                  <i key={color.offset} style={{ background: color.css }} />
                ))}
              </span>
              {label}
            </span>
          </label>
        ))}
      </fieldset>
      {colorField}
      <div className="theme-palette-preview">
        <div
          className="theme-palette-strip"
          style={{ background: paletteGradient(value) }}
          aria-hidden="true"
        />
        <ul aria-label="Generated palette" className="theme-palette-colors">
          {colors.map((color, index) => (
            <li
              key={color.offset}
              aria-label={`${index === 0 ? 'Primary' : `Companion ${index}`} ${color.hex}`}
            >
              <span aria-hidden="true" style={{ background: color.css }} />
              <span>{color.hex}</span>
            </li>
          ))}
        </ul>
        <p id={`${inputId}-harmony-help`} className="sr-only">
          {harmony === 'single'
            ? 'One color, tonal gradients.'
            : harmony === 'duo'
              ? 'An opposite hue follows your primary color.'
              : 'Three evenly spaced hues follow your primary color.'}
        </p>
      </div>
      <fieldset
        className="flex items-center justify-between gap-2 border-0 p-0"
        aria-label="Theme presets"
      >
        {PRESET_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            onClick={() =>
              onChange({
                ...theme,
                isDark: value.isDark,
                appearance: value.appearance,
                atmosphere: value.atmosphere,
                harmony: value.harmony,
              })
            }
            aria-label={theme.name}
            aria-pressed={value.id === theme.id}
            title={theme.name}
            className="theme-swatch size-9 rounded-full flex items-center justify-center transition-transform hover:scale-110"
            style={{
              background: paletteGradient({ ...theme, harmony: value.harmony }),
            }}
          >
            {value.id === theme.id && (
              <span
                className="theme-swatch-check"
                style={{
                  background: themeTokens(theme)['--color-accent'],
                  color: themeTokens(theme)['--color-on-accent'],
                }}
              >
                <Check aria-hidden="true" className="size-3.5" />
              </span>
            )}
          </button>
        ))}
      </fieldset>
      {colorControls}
    </div>
  );
}
