import { characterMarkViewBox, characterPaths } from '@jackalope/brand/character';
import { DEFAULT_THEME, themeTokens } from '@jackalope/brand/tokens';

const colors = (isDark: boolean) =>
  Object.entries(themeTokens({ ...DEFAULT_THEME, isDark, appearance: 'manual' }))
    .map(([key, value]) => `${key}:${value};`)
    .join('');

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${characterMarkViewBox}" fill="currentColor" aria-hidden="true"><path d="${characterPaths.farEar}" opacity=".6"/><path d="${characterPaths.antler}" opacity=".8"/><path d="${characterPaths.nearEar}"/><path d="${characterPaths.head}"/></svg>`;
export const adminHead = `<meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light dark"><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(mark.replace('currentColor', '#6366f1'))}">`;
export const adminThemeStyles = `:root{${colors(false)}color-scheme:light;--surface:var(--color-surface);--text:var(--color-text-primary);--muted:var(--color-text-secondary);--line:var(--color-border-subtle);--accent:var(--color-accent-ink)}@media(prefers-color-scheme:dark){:root{${colors(true)}color-scheme:dark}}`;
