import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from '../../apps/website/node_modules/vite/dist/node/index.js';

const html = 'apps/website/.devices-fixture.html';
const entry = 'apps/website/.devices-fixture.tsx';
if (existsSync(html) || existsSync(entry))
  throw Error('Inspect the existing device fixture first.');
mkdirSync('output/connected-desktops', { recursive: true });
process.env.VITE_ACCESS_API = 'https://devices.example.invalid';
const server = await createServer({
  root: 'apps/website',
  server: { host: '127.0.0.1', port: 5189, strictPort: true },
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  writeFileSync(
    html,
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.devices-fixture.tsx"></script></body></html>',
  );
  writeFileSync(
    entry,
    `import React from 'react';
import {createRoot} from 'react-dom/client';
import {applyThemeTokens,DEFAULT_THEME} from '@jackalope/brand/theme';
import {ConnectedDesktops} from './src/DesktopConnection';
import '@jackalope/brand/fonts.css';
import './src/styles.css';
import './src/access.css';
applyThemeTokens({...DEFAULT_THEME,isDark:new URLSearchParams(location.search).has('dark')});
createRoot(document.getElementById('root')).render(<main className="access-page" style={{padding:24}}><ConnectedDesktops/></main>);`,
  );
  await server.listen();
  for (const width of [1280, 960, 375]) {
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 1280 ? 840 : 640 },
        reducedMotion: dark ? 'reduce' : 'no-preference',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let devices = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Studio PC',
          createdAt: 1788900000000,
          expiresAt: 1796676000000,
          appVersion: '0.1.0',
          platform: 'windows',
          buildKind: 'development',
          profileKind: 'isolated',
          lastSeenAt: 1789065000000,
          settingsCheckedAt: 1789065000000,
          settingsSync: 1,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Studio PC',
          createdAt: 1788800000000,
          expiresAt: 1796576000000,
        },
      ];
      let revoked = '';
      await page.route('https://devices.example.invalid/**', async (route) => {
        if (route.request().url().endsWith('/desktop/revoke')) {
          revoked = route.request().postDataJSON().id;
          devices = devices.filter((device) => device.id !== revoked);
          return route.fulfill({ json: { success: true } });
        }
        await route.fulfill({ json: devices });
      });
      await page.goto(`http://127.0.0.1:5189/.devices-fixture.html${dark ? '?dark' : ''}`);
      await page.getByText('Jackalope 0.1.0 · Development build', { exact: true }).waitFor();
      assert.equal(await page.locator('.desktop-device-row').count(), 2);
      assert.equal(await page.getByText('Not recorded yet', { exact: true }).count(), 1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true }).first();
      await disconnect.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(revoked, '');
      await page.screenshot({
        path: `output/connected-desktops/${width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Disconnect', exact: true }).first().click();
      await page.getByRole('button', { name: 'Confirm disconnect', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll('.desktop-device-row').length === 1,
      );
      assert.equal(revoked, '11111111-1111-4111-8111-111111111111');
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  console.log(
    'Connected desktop fixtures passed: metadata, older records, same-name profiles, scoped revocation, keyboard, themes, reduced motion and 1280/960/375px layouts. No live connections changed.',
  );
} finally {
  await browser.close();
  await server.close();
  for (const file of [html, entry]) if (existsSync(file)) unlinkSync(file);
}
