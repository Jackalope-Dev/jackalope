export type ColorHarmony = 'single' | 'duo' | 'trio';

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
  harmony?: ColorHarmony;
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

export function paletteColors(theme: ThemePalette) {
  const offsets =
    theme.harmony === 'trio' ? [0, 120, 240] : theme.harmony === 'duo' ? [0, 180] : [0];
  return offsets.map((offset) => {
    const hue = (theme.accentHue + offset) % 360;
    return {
      offset,
      hue,
      hex: hslToHex(hue, theme.accentSat, theme.accentLight),
      css: `hsl(${hue} ${theme.accentSat}% ${theme.accentLight}%)`,
    };
  });
}

export function paletteGradient(theme: ThemePalette) {
  const colors = paletteColors(theme);
  const stops =
    colors.length === 1
      ? [`hsl(${theme.accentHue} ${theme.accentSat}% 80%)`, colors[0].css]
      : colors.map((color) => color.css);
  return `linear-gradient(135deg, ${stops.join(', ')})`;
}

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
  const colors = paletteColors(theme);
  const lastHue = colors[colors.length - 1].hue;
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
  set('--color-accent-subtle', `hsl(${accentHue} ${accentSat}% ${accentLight}% / 0.12)`);
  set('--color-accent-glow', `hsl(${accentHue} ${accentSat}% ${accentLight}% / 0.28)`);
  const luminance = relativeLuminance(hslToHex(accentHue, accentSat, accentLight));
  set('--color-on-accent', luminance > 0.179 ? '#000000' : '#ffffff');
  const hoverLight =
    luminance > 0.179 ? Math.min(100, accentLight + 6) : Math.max(0, accentLight - 6);
  set('--color-accent-hover', `hsl(${accentHue} ${accentSat}% ${hoverLight}%)`);
  let actionLight = accentLight;
  let actionText = luminance <= 1.05 / 4.5 - 0.05 ? '#ffffff' : '#000000';
  if (actionText === '#000000') {
    for (let depth = 0.5; depth <= 12; depth += 0.5) {
      const candidate = Math.max(0, accentLight - depth);
      if (1.05 / (relativeLuminance(hslToHex(accentHue, accentSat, candidate)) + 0.05) >= 4.6) {
        actionLight = candidate;
        actionText = '#ffffff';
        break;
      }
    }
  }
  const actionHoverLight =
    actionText === '#ffffff' ? Math.max(0, actionLight - 5) : Math.min(100, actionLight + 5);
  set('--color-action', `hsl(${accentHue} ${accentSat}% ${actionLight}%)`);
  set('--color-action-hover', `hsl(${accentHue} ${accentSat}% ${actionHoverLight}%)`);
  set('--color-on-action', actionText);
  set('--color-palette-gradient', paletteGradient(theme));
  set('--color-accent-secondary', (colors[1] ?? colors[0]).css);
  set('--color-accent-tertiary', (colors[2] ?? colors[1] ?? colors[0]).css);
  set('--color-shell', tone(dark ? 10 : 90, atmosphere + 8));
  set('--color-shell-end', `hsl(${lastHue} ${atmosphere}% ${dark ? 6 : 94}%)`);
  const shellStops =
    colors.length === 3
      ? [
          'var(--color-shell)',
          `hsl(${colors[1].hue} ${atmosphere + 4}% ${dark ? 8 : 92}%)`,
          'var(--color-shell-end)',
        ]
      : ['var(--color-shell)', 'var(--color-shell-end)'];
  set('--color-shell-gradient', `linear-gradient(145deg, ${shellStops.join(', ')})`);
  const onboardingStops = colors.map(
    (color, index) => `hsl(${color.hue} ${atmosphere}% ${dark ? 9 - index * 2 : 96 - index}%)`,
  );
  set(
    '--color-onboarding-gradient',
    colors.length === 1
      ? 'linear-gradient(145deg, var(--color-surface), var(--color-surface-sunken))'
      : `linear-gradient(145deg, ${onboardingStops.join(', ')})`,
  );
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

  const backgrounds = colors.map((color) =>
    relativeLuminance(hslToHex(color.hue, atmosphere + 8, dark ? 15 : 90)),
  );
  let inkLight = accentLight;
  while (inkLight > 0 && inkLight < 100) {
    const ink = relativeLuminance(hslToHex(accentHue, accentSat, inkLight));
    if (
      backgrounds.every(
        (background) =>
          (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) >= 7,
      )
    )
      break;
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
  let dangerLight = dark ? 75 : 38;
  const dangerSat = dark ? 90 : 72;
  while (dangerLight > 0 && dangerLight < 100) {
    const danger = relativeLuminance(hslToHex(0, dangerSat, dangerLight));
    if (
      backgrounds.every(
        (background) =>
          (Math.max(danger, background) + 0.05) / (Math.min(danger, background) + 0.05) >= 4.6,
      )
    )
      break;
    dangerLight += dark ? 1 : -1;
  }
  set('--color-danger', `hsl(0 ${dangerSat}% ${dangerLight}%)`);
  const shadow = `hsl(${accentHue} ${atmosphere}% 10% / ${dark ? 0.6 : 0.14})`;
  set('--shadow-flat', `0 1px 2px ${shadow}`);
  set('--shadow-selection', `0 2px 5px -1px ${shadow}, 0 1px 2px ${shadow}`);
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
