import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { characterPaths } from '../../../packages/brand/src/character.ts';
import { PROVIDER_MARKS } from '../../../packages/brand/src/provider-marks.ts';

// Renders social-preview.html to the Open Graph image. Uses installed Edge on
// Windows and Playwright's Chromium elsewhere; UI_BROWSER_CHANNEL overrides it.
// The agents match the landing page hero's roster.
const agents = [
  ['codex', 'Codex'],
  ['claude', 'Claude Code'],
  ['gemini', 'Gemini CLI'],
  ['grok', 'Grok'],
  ['opencode', 'OpenCode'],
  ['kimi', 'Kimi Code'],
  ['antigravity', 'Antigravity'],
].map(([id, name]) => ({ name, color: PROVIDER_MARKS[id].color, paths: PROVIDER_MARKS[id].paths }));
const mark = [
  characterPaths.farEar,
  characterPaths.nearEar,
  characterPaths.antler,
  characterPaths.head,
];

const channel =
  process.env.UI_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ channel, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(new URL('./social-preview.html', import.meta.url).href);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((data) => window.render(data), { mark, agents });
  await page.screenshot({
    path: fileURLToPath(new URL('../public/social-preview.png', import.meta.url)),
  });
} finally {
  await browser.close();
}
