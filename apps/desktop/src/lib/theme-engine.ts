export interface ThemePalette {
  id: string;
  name: string;
  accentHue: number;
  accentSat: number;
  accentLight: number;
  accentHex: string;
  isDark: boolean;
  atmosphere?: number;
}

export const PRESET_THEMES: ThemePalette[] = [
  {
    id: 'mojave-sunset',
    name: 'Mojave Sunset',
    accentHue: 24,
    accentSat: 95,
    accentLight: 53,
    accentHex: '#f97316',
    isDark: true,
  },
  {
    id: 'alpine-aurora',
    name: 'Alpine Aurora',
    accentHue: 160,
    accentSat: 84,
    accentLight: 44,
    accentHex: '#10b981',
    isDark: true,
  },
  {
    id: 'electric-indigo',
    name: 'Electric Indigo',
    accentHue: 245,
    accentSat: 88,
    accentLight: 64,
    accentHex: '#6366f1',
    isDark: true,
  },
  {
    id: 'zen-rose',
    name: 'Zen Rose',
    accentHue: 335,
    accentSat: 85,
    accentLight: 60,
    accentHex: '#f43f5e',
    isDark: true,
  },
  {
    id: 'cyber-cyan',
    name: 'Cyber Cyan',
    accentHue: 190,
    accentSat: 92,
    accentLight: 48,
    accentHex: '#06b6d4',
    isDark: true,
  },
  {
    id: 'neon-amber',
    name: 'Golden Antler',
    accentHue: 45,
    accentSat: 96,
    accentLight: 54,
    accentHex: '#eab308',
    isDark: true,
  },
];

export function applyThemeTokens(theme: ThemePalette) {
  const root = document.documentElement;
  const { accentHue, accentSat, accentLight } = theme;
  const atmosphere = theme.atmosphere ?? 12;
  const dark = theme.isDark !== false;
  const tone = (light: number, saturation = atmosphere) =>
    `hsl(${accentHue} ${saturation}% ${light}%)`;
  root.style.setProperty('color-scheme', dark ? 'dark' : 'light');
  root.style.setProperty('--brand-brightness', dark ? '1' : '0.2');

  root.style.setProperty('--accent-h', `${accentHue}`);
  root.style.setProperty('--accent-s', `${accentSat}%`);
  root.style.setProperty('--accent-l', `${accentLight}%`);

  root.style.setProperty('--color-accent', `hsl(${accentHue} ${accentSat}% ${accentLight}%)`);
  root.style.setProperty(
    '--color-accent-hover',
    `hsl(${accentHue} ${accentSat}% ${Math.max(10, accentLight - 6)}%)`,
  );
  root.style.setProperty(
    '--color-accent-subtle',
    `hsl(${accentHue} ${accentSat}% ${accentLight}% / 0.12)`,
  );
  root.style.setProperty(
    '--color-accent-glow',
    `hsl(${accentHue} ${accentSat}% ${accentLight}% / 0.28)`,
  );
  const luminance = relativeLuminance(hslToHex(accentHue, accentSat, accentLight));
  root.style.setProperty('--color-on-accent', luminance > 0.179 ? '#000000' : '#ffffff');
  root.style.setProperty('--color-shell', tone(dark ? 10 : 90, atmosphere + 8));
  root.style.setProperty('--color-shell-end', tone(dark ? 6 : 94));
  root.style.setProperty(
    '--color-spectrum',
    'linear-gradient(90deg, hsl(0 75% 62%), hsl(60 75% 62%), hsl(120 75% 62%), hsl(180 75% 62%), hsl(240 75% 62%), hsl(300 75% 62%), hsl(360 75% 62%))',
  );

  root.style.setProperty('--color-bg', tone(dark ? 6 : 98));
  root.style.setProperty('--color-surface', tone(dark ? 9 : 96));
  root.style.setProperty('--color-surface-hover', tone(dark ? 13 : 93, atmosphere + 2));
  root.style.setProperty('--color-surface-elevated', tone(dark ? 15 : 100, atmosphere + 4));
  root.style.setProperty('--color-surface-sunken', tone(dark ? 5 : 94));
  root.style.setProperty('--color-border', tone(dark ? 19 : 80));
  root.style.setProperty('--color-border-subtle', tone(dark ? 14 : 88));
  root.style.setProperty('--color-text-primary', tone(dark ? 96 : 13, 10));
  root.style.setProperty('--color-text-secondary', tone(dark ? 70 : 30, 8));
  root.style.setProperty('--color-text-muted', tone(dark ? 65 : 35, 6));

  const background = relativeLuminance(hslToHex(accentHue, atmosphere + 8, dark ? 15 : 90));
  let inkLight = accentLight;
  while (inkLight > 0 && inkLight < 100) {
    const ink = relativeLuminance(hslToHex(accentHue, accentSat, inkLight));
    if ((Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) >= 7) break;
    inkLight = dark ? Math.min(100, inkLight + 1) : Math.max(0, inkLight - 1);
  }
  if (dark && inkLight === 0) inkLight = 100;
  if (!dark && inkLight === 100) inkLight = 0;
  root.style.setProperty('--color-accent-ink', tone(inkLight, accentSat));
  root.style.setProperty('--color-border-focus', 'var(--color-accent-ink)');
  root.style.setProperty('--color-success', dark ? 'hsl(160 64% 65%)' : 'hsl(160 75% 23%)');
  root.style.setProperty('--color-warning', dark ? 'hsl(40 95% 65%)' : 'hsl(35 90% 27%)');
  root.style.setProperty('--color-danger', dark ? 'hsl(0 90% 75%)' : 'hsl(0 72% 38%)');
  const shadow = `hsl(${accentHue} ${atmosphere}% 10% / ${dark ? 0.6 : 0.14})`;
  root.style.setProperty('--shadow-flat', `0 1px 2px ${shadow}`);
  root.style.setProperty(
    '--shadow-surface',
    `0 4px 16px -2px ${shadow}, 0 0 0 1px var(--color-border)`,
  );
  root.style.setProperty(
    '--shadow-pop',
    `0 16px 60px ${shadow}, 0 0 0 1px var(--color-border-subtle)`,
  );
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}
