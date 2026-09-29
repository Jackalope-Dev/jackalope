import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Renders social-preview.html to the Open Graph image. Uses installed Edge on
// Windows and Playwright's Chromium elsewhere; UI_BROWSER_CHANNEL overrides it.
const channel =
  process.env.UI_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ channel, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(new URL('./social-preview.html', import.meta.url).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: fileURLToPath(new URL('../public/social-preview.png', import.meta.url)),
  });
} finally {
  await browser.close();
}
