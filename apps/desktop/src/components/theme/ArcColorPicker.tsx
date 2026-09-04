import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { PRESET_THEMES } from '../../lib/theme-engine';
import { Palette, Check, Sparkles } from 'lucide-react';

export function ArcColorPicker() {
  const { currentTheme, setTheme, setCustomHsl, setCustomAccentHex } = useThemeStore();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-all cursor-pointer shadow-sm text-xs font-medium text-[var(--color-text-primary)]"
        title="Arc / Zen Theme Selector"
      >
        <span
          className="w-3.5 h-3.5 rounded-full ring-2 ring-[var(--color-border)] shadow-sm"
          style={{ backgroundColor: currentTheme.accentHex }}
        />
        <span className="hidden sm:inline">{currentTheme.name}</span>
        <Palette className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
      </button>

      {/* Popover / Flyout Menu */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-72 p-3.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-primary)]">
                <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>Theme & Color Pops</span>
              </div>
              <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                Arc / Zen Style
              </span>
            </div>

            {/* Presets Grid */}
            <div className="mb-3">
              <span className="text-[11px] font-medium text-[var(--color-text-secondary)] block mb-1.5">
                Curated Palettes
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {PRESET_THEMES.map((theme) => {
                  const isSelected = currentTheme.id === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setTheme(theme)}
                      className={`flex items-center gap-1.5 p-1.5 rounded-lg text-xs font-medium text-left border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-text-primary)]'
                          : 'border-transparent hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0 shadow-sm flex items-center justify-center"
                        style={{ backgroundColor: theme.accentHex }}
                      >
                        {isSelected && <Check className="w-2 h-2 text-black stroke-[3]" />}
                      </span>
                      <span className="truncate text-[11px]">{theme.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Continuous Spectrum Hue Slider */}
            <div className="space-y-2 pt-1 border-t border-[var(--color-border-subtle)]">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--color-text-secondary)]">Custom Hue Spectrum</span>
                <span className="font-mono text-[var(--color-accent)] text-[10px]">
                  {currentTheme.accentHue}°
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="360"
                value={currentTheme.accentHue}
                onChange={(e) =>
                  setCustomHsl(
                    Number(e.target.value),
                    currentTheme.accentSat || 90,
                    currentTheme.accentLight || 52
                  )
                }
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background:
                    'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
                }}
              />

              {/* Hex Input */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-[var(--color-text-secondary)]">Hex Accent</span>
                <div className="flex items-center gap-1.5 bg-[var(--color-surface-sunken)] border border-[var(--color-border)] rounded-md px-2 py-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: currentTheme.accentHex }}
                  />
                  <input
                    type="text"
                    value={currentTheme.accentHex}
                    onChange={(e) => setCustomAccentHex(e.target.value)}
                    className="w-16 text-[11px] font-mono bg-transparent border-0 text-[var(--color-text-primary)] focus:outline-none"
                    maxLength={7}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
