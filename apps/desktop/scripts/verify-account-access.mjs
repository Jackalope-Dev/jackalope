import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const output = new URL('../scratch/account-access/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL('fixture.html', output),
  `<!doctype html><html><body><div id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccessBoundary } from '/src/components/account/AccessBoundary.tsx';
import { useOnboardingStore } from '/src/stores/onboardingStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
useOnboardingStore.setState({ status: 'complete' });
window.setFixtureTheme = (isDark) => {
  const store = useThemeStore.getState();
  store.setAppTheme({ ...store.appTheme, appearance: 'manual', isDark });
};
createRoot(document.getElementById('root')).render(
  React.createElement(AccessBoundary, null, React.createElement('h1', null, 'Workspace fixture'))
);
</script></body></html>`,
);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.accessFixture = { allowed: false, fail: false };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 0,
      invoke: async (command) => {
        if (command === 'app_execution_access') {
          if (window.accessFixture.fail) throw new Error('Fixture access check failed');
          return { required: true, allowed: window.accessFixture.allowed, validUntil: null };
        }
        if (command === 'app_account_status')
          return { state: 'disconnected', email: null, userCode: null, expiresAt: null };
        if (command === 'app_community_settings')
          return { reviewed: true, telemetry: false, errors: false, configured: false };
        if (command === 'app_settings_sync')
          return { available: false, enabled: false, owner: null };
        if (command === 'plugin:window|is_maximized') return false;
        return null;
      },
    };
  });
  const origin = process.env.JACKALOPE_TEST_URL ?? 'http://127.0.0.1:5191';
  await page.goto(`${origin}/scratch/account-access/fixture.html`);
  const welcome = page.getByRole('heading', { name: 'Welcome to Jackalope.', exact: true });
  const workspace = page.getByRole('heading', { name: 'Workspace fixture', exact: true });
  await welcome.waitFor();
  await page.waitForTimeout(2300);
  assert.equal(await workspace.count(), 0, 'Saved setup completion must not bypass account access');
  assert.equal(await page.getByRole('button', { name: /Continue in development/ }).count(), 0);
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const isDark of [true, false]) {
      await page.evaluate((dark) => window.setFixtureTheme(dark), isDark);
      await page.emulateMedia({ reducedMotion: isDark ? 'no-preference' : 'reduce' });
      const connect = page.getByRole('button', { name: 'Connect account', exact: true });
      await page.locator('.access-privacy > summary').focus();
      await page.keyboard.press('Tab');
      assert.equal(await connect.evaluate((element) => document.activeElement === element), true);
      const bounds = await connect.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= (width === 1280 ? 840 : 640));
      await page.screenshot({
        path: fileURLToPath(new URL(`${width}-${isDark ? 'dark' : 'light'}.png`, output)),
      });
    }
  }
  await page.evaluate(() => {
    window.accessFixture.fail = true;
  });
  await page.getByRole('alert').filter({ hasText: 'We couldn’t check your access' }).waitFor();
  assert.equal(await workspace.count(), 0);
  await page.evaluate(() => {
    window.accessFixture.fail = false;
    window.accessFixture.allowed = true;
  });
  await workspace.waitFor();
  await page.evaluate(() => {
    window.accessFixture.allowed = false;
  });
  await page.getByRole('status').filter({ hasText: 'Connect an approved account' }).waitFor();
  assert.equal(await workspace.isVisible(), true, 'Revocation must retain saved-work access');
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await welcome.waitFor();
  assert.equal(await workspace.count(), 0);
  await page.evaluate(() => {
    window.accessFixture.allowed = true;
  });
  await workspace.waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Account boundary fixtures passed: no bypass, saved setup, errors, approval, revocation, reconnect, themes, keyboard focus and narrow layouts. No native tasks or real accounts used.',
  );
} finally {
  await browser.close();
}
