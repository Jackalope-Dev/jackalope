export interface ThemePalette {
  id: string;
  name: string;
  accentHue: number;
  accentSat: number;
  accentLight: number;
  accentHex: string;
  isDark: boolean;
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

  root.style.setProperty('--accent-h', `${accentHue}`);
  root.style.setProperty('--accent-s', `${accentSat}%`);
  root.style.setProperty('--accent-l', `${accentLight}%`);

  root.style.setProperty('--color-accent', `hsl(${accentHue} ${accentSat}% ${accentLight}%)`);
  root.style.setProperty('--color-accent-hover', `hsl(${accentHue} ${accentSat}% ${Math.max(10, accentLight - 6)}%)`);
  root.style.setProperty('--color-accent-subtle', `hsl(${accentHue} ${accentSat}% ${accentLight}% / 0.12)`);
  root.style.setProperty('--color-accent-glow', `hsl(${accentHue} ${accentSat}% ${accentLight}% / 0.28)`);

  // Arc/Zen style surface tint: subtly mix the accent hue into dark surfaces
  const tintHue = accentHue;
  root.style.setProperty('--color-bg', `hsl(${tintHue} 10% 5%)`);
  root.style.setProperty('--color-surface', `hsl(${tintHue} 12% 8.5%)`);
  root.style.setProperty('--color-surface-hover', `hsl(${tintHue} 14% 11.5%)`);
  root.style.setProperty('--color-surface-elevated', `hsl(${tintHue} 16% 14%)`);
  root.style.setProperty('--color-surface-sunken', `hsl(${tintHue} 8% 4%)`);
  root.style.setProperty('--color-border', `hsl(${tintHue} 12% 16%)`);
  root.style.setProperty('--color-border-subtle', `hsl(${tintHue} 10% 12%)`);
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
    cleanHex = cleanHex.split('').map((c) => c + c).join('');
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
