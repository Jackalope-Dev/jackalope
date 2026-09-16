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
import {AccessPage} from './src/Access';
import '@jackalope/brand/fonts.css';
import './src/styles.css';
import './src/access.css';
applyThemeTokens({...DEFAULT_THEME,isDark:new URLSearchParams(location.search).has('dark')});
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('access') ? <AccessPage/> : <main className="access-page" style={{padding:24}}><ConnectedDesktops/></main>);`,
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
      const member = {
        email: 'member@example.invalid',
        limit: 5,
        remaining: 3,
        accepted: 0,
        downloaded: 0,
        connected: 0,
        invites: [],
        download: null,
        shareUrl: `https://jackalope.dev/access/?invite=${'c'.repeat(64)}`,
      };
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
          platform: 'windows',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Studio PC',
          platform: 'linux',
          createdAt: 1788800000000,
          expiresAt: 1796576000000,
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Studio PC',
          createdAt: 1788800000000,
          expiresAt: 1796576000000,
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          createdAt: 1788800000000,
          expiresAt: 1796576000000,
        },
        {
          id: '66666666-6666-4666-8666-666666666666',
          createdAt: 1788800000000,
          expiresAt: 1796576000000,
        },
      ];
      let revoked = '';
      await page.route('https://devices.example.invalid/**', async (route) => {
        if (route.request().url().endsWith('/me')) return route.fulfill({ json: member });
        if (route.request().url().endsWith('/desktop/revoke')) {
          revoked = route.request().postDataJSON().id;
          devices = devices.filter((device) => device.id !== revoked);
          return route.fulfill({ json: { success: true } });
        }
        await route.fulfill({ json: devices });
      });
      await page.goto(`http://127.0.0.1:5189/.devices-fixture.html${dark ? '?dark' : ''}`);
      const group = page.locator('.desktop-device-group');
      const summary = group.locator('summary');
      await summary.waitFor();
      assert.equal(await group.count(), 1);
      assert.match(await summary.textContent(), /2 connections with this name/);
      assert.equal(await group.getAttribute('open'), null);
      await summary.focus();
      await page.keyboard.press('Enter');
      await page.getByText('Jackalope 0.1.0 · Development build', { exact: true }).waitFor();
      assert.notEqual(await summary.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
      assert.equal(await page.locator('.desktop-device-row').count(), 6);
      assert.equal(await group.locator('.desktop-device-row').count(), 2);
      assert.equal(await page.getByText('Not recorded yet', { exact: true }).count(), 5);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true }).first();
      await disconnect.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(revoked, '');
      assert(await disconnect.evaluate((el) => el === document.activeElement));
      await page.screenshot({
        path: `output/connected-desktops/${width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Disconnect', exact: true }).first().click();
      await page.getByRole('button', { name: 'Confirm disconnect', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll('.desktop-device-row').length === 5,
      );
      assert.equal(revoked, '11111111-1111-4111-8111-111111111111');
      assert.equal(await group.count(), 0);
      await page.goto(`http://127.0.0.1:5189/.devices-fixture.html?access${dark ? '&dark' : ''}`);
      const email = page.getByRole('link', { name: 'Email', exact: true });
      await email.waitFor();
      const dimensions = await page.locator('.access-share-actions > *').evaluateAll((elements) =>
        elements.map((el) => ({
          height: el.getBoundingClientRect().height,
          fontSize: getComputedStyle(el).fontSize,
          padding: getComputedStyle(el).padding,
        })),
      );
      assert(dimensions.length >= 4);
      assert(dimensions.every((size) => size.height >= 44));
      assert(dimensions.every((size) => JSON.stringify(size) === JSON.stringify(dimensions[0])));
      assert.match(await email.getAttribute('href'), /^mailto:\?subject=/);
      await email.focus();
      assert.notEqual(await email.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
      await page.keyboard.press('Tab');
      assert(
        await page
          .getByRole('button', { name: 'X (Twitter)' })
          .evaluate((el) => el === document.activeElement),
      );
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('.access-share-actions').screenshot({
        path: `output/connected-desktops/share-${width}-${dark ? 'dark' : 'light'}.png`,
      });
      member.remaining = 0;
      await page.reload();
      await page.locator('.access-share-actions a[aria-disabled="true"]').waitFor();
      assert.equal(await email.getAttribute('tabindex'), '-1');
      assert(await page.getByRole('button', { name: 'X (Twitter)' }).isDisabled());
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  console.log(
    'Access fixtures passed: matching-name grouping, separate platforms and unnamed profiles, scoped revocation, equal share-button sizing, keyboard, themes, reduced motion and 1280/960/375px layouts. No live connections changed.',
  );
} finally {
  await browser.close();
  await server.close();
  for (const file of [html, entry]) if (existsSync(file)) unlinkSync(file);
}
