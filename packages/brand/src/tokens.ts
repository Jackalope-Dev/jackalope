export interface ThemePalette {
  id: string;
  name: string;
  accentHue: number;
  accentSat: number;
  accentLight: number;
  accentHex: string;
  isDark: boolean;
  appearance?: 'manual' | 'automatic';
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

export const DEFAULT_THEME = PRESET_THEMES[2];

export function isDarkAtTime(theme: ThemePalette, now = new Date()) {
  if (theme.appearance !== 'automatic') return theme.isDark !== false;
  return now.getHours() < 7 || now.getHours() >= 19;
}

export function themeTokens(theme: ThemePalette) {
  const tokens: Record<string, string> = {};
  const set = (name: string, value: string) => {
    tokens[name] = value;
  };
  const { accentHue, accentSat, accentLight } = theme;
  const atmosphere = theme.atmosphere ?? 12;
  const dark = isDarkAtTime(theme);
  const tone = (light: number, saturation = atmosphere) =>
    `hsl(${accentHue} ${saturation}% ${light}%)`;
  set('color-scheme', dark ? 'dark' : 'light');
  set('--brand-brightness', dark ? '1' : '0.2');

  set('--accent-h', `${accentHue}`);
  set('--accent-s', `${accentSat}%`);
  set('--accent-l', `${accentLight}%`);

  set('--color-accent', `hsl(${accentHue} ${accentSat}% ${accentLight}%)`);
  set('--color-accent-hover', `hsl(${accentHue} ${accentSat}% ${Math.max(10, accentLight - 6)}%)`);
  set('--color-accent-subtle', `hsl(${accentHue} ${accentSat}% ${accentLight}% / 0.12)`);
  set('--color-accent-glow', `hsl(${accentHue} ${accentSat}% ${accentLight}% / 0.28)`);
  const luminance = relativeLuminance(hslToHex(accentHue, accentSat, accentLight));
  set('--color-on-accent', luminance > 0.179 ? '#000000' : '#ffffff');
  set('--color-shell', tone(dark ? 10 : 90, atmosphere + 8));
  set('--color-shell-end', tone(dark ? 6 : 94));
  set(
    '--color-spectrum',
    'linear-gradient(90deg, hsl(0 75% 62%), hsl(60 75% 62%), hsl(120 75% 62%), hsl(180 75% 62%), hsl(240 75% 62%), hsl(300 75% 62%), hsl(360 75% 62%))',
  );

  set('--color-bg', tone(dark ? 6 : 98));
  set('--color-surface', tone(dark ? 9 : 96));
  set('--color-surface-hover', tone(dark ? 13 : 93, atmosphere + 2));
  set('--color-surface-elevated', tone(dark ? 15 : 100, atmosphere + 4));
  set('--color-surface-sunken', tone(dark ? 5 : 94));
  set('--color-header-search', tone(dark ? 5 : 86, atmosphere + 8));
  set('--color-border', tone(dark ? 19 : 80));
  set('--color-border-subtle', tone(dark ? 14 : 88));
  set('--color-text-primary', tone(dark ? 96 : 13, 10));
  set('--color-text-secondary', tone(dark ? 70 : 30, 8));
  set('--color-text-muted', tone(dark ? 65 : 35, 6));

  const background = relativeLuminance(hslToHex(accentHue, atmosphere + 8, dark ? 15 : 90));
  let inkLight = accentLight;
  while (inkLight > 0 && inkLight < 100) {
    const ink = relativeLuminance(hslToHex(accentHue, accentSat, inkLight));
    if ((Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) >= 7) break;
    inkLight = dark ? Math.min(100, inkLight + 1) : Math.max(0, inkLight - 1);
  }
  if (dark && inkLight === 0) inkLight = 100;
  if (!dark && inkLight === 100) inkLight = 0;
  set('--color-accent-ink', tone(inkLight, accentSat));
  set('--color-border-focus', 'var(--color-accent-ink)');
  set('--color-success', dark ? 'hsl(160 64% 65%)' : 'hsl(160 75% 23%)');
  set('--color-agent-codex', dark ? 'hsl(160 55% 70%)' : 'hsl(160 65% 28%)');
  set('--color-agent-claude', dark ? 'hsl(22 75% 72%)' : 'hsl(22 65% 35%)');
  set('--color-agent-grok', dark ? 'hsl(255 65% 80%)' : 'hsl(255 45% 40%)');
  set('--color-warning', dark ? 'hsl(40 95% 65%)' : 'hsl(35 90% 27%)');
  set('--color-danger', dark ? 'hsl(0 90% 75%)' : 'hsl(0 72% 38%)');
  const shadow = `hsl(${accentHue} ${atmosphere}% 10% / ${dark ? 0.6 : 0.14})`;
  set('--shadow-flat', `0 1px 2px ${shadow}`);
  set('--shadow-surface', `0 4px 16px -2px ${shadow}, 0 0 0 1px var(--color-border)`);
  set('--shadow-pop', `0 16px 60px ${shadow}, 0 0 0 1px var(--color-border-subtle)`);
  return tokens;
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
