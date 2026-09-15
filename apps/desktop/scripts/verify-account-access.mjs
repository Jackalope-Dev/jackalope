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
    const disconnected = { state: 'disconnected', email: null, userCode: null, expiresAt: null };
    const waiting = {
      state: 'waiting',
      email: 'waiting@example.invalid',
      userCode: null,
      expiresAt: Date.now() + 86400000,
      waitlist: {
        position: 42,
        referrals: 3,
        pending: 1,
        priorityDays: 3,
        shareUrl: `https://jackalope.dev/?ref=${'c'.repeat(64)}`,
        checkedAt: Date.now(),
      },
    };
    window.accessFixture = {
      allowed: false,
      fail: false,
      account: disconnected,
      clipboard: '',
      copyFails: false,
      opened: [],
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => {
          if (window.accessFixture.copyFails) throw new Error('Fixture clipboard unavailable');
          window.accessFixture.clipboard = value;
        },
      },
    });
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 0,
      invoke: async (command, args) => {
        if (command === 'app_execution_access') {
          if (window.accessFixture.fail) throw new Error('Fixture access check failed');
          return { required: true, allowed: window.accessFixture.allowed, validUntil: null };
        }
        if (command === 'app_account_status') return structuredClone(window.accessFixture.account);
        if (command === 'app_account_connect') {
          window.accessFixture.account = {
            state: 'pending',
            email: null,
            userCode: 'ABCD1234',
            expiresAt: Date.now() + 600000,
          };
          return structuredClone(window.accessFixture.account);
        }
        if (command === 'app_account_poll') {
          if (window.accessFixture.account.state === 'pending')
            window.accessFixture.account = structuredClone(waiting);
          return structuredClone(window.accessFixture.account);
        }
        if (command === 'app_account_disconnect') {
          window.accessFixture.account = disconnected;
          return disconnected;
        }
        if (command === 'plugin:shell|open') window.accessFixture.opened.push(args.path);
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
      await page.waitForTimeout(350);
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
  await page.getByRole('button', { name: 'Connect account', exact: true }).click();
  await page.getByText('ABCD–1234').waitFor();
  const waitlistHeading = page.getByRole('heading', { name: 'You’re on the list.' });
  await waitlistHeading.waitFor();
  assert.equal(
    await waitlistHeading.evaluate((element) => document.activeElement === element),
    true,
  );
  assert.equal(
    await page
      .getByText('This connection request expires in 10 minutes.', { exact: false })
      .count(),
    0,
  );
  assert.equal(await workspace.count(), 0, 'A waitlist connection must not admit the workspace');
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  assert.match(
    await page.evaluate(() => window.accessFixture.clipboard),
    /^https:\/\/jackalope.dev\/\?ref=c{64}$/,
  );
  await page.getByRole('button', { name: 'Copy share message', exact: true }).click();
  assert.match(
    await page.evaluate(() => window.accessFixture.clipboard),
    /Join me on the Jackalope waitlist/,
  );
  const input = page.getByRole('textbox', { name: 'Your referral link' });
  await input.focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON');
  await page.getByRole('button', { name: 'Watch the app tour' }).click();
  await page.getByRole('button', { name: 'About Jackalope' }).click();
  await page.waitForFunction(() => window.accessFixture.opened.length === 2);
  assert.deepEqual(await page.evaluate(() => window.accessFixture.opened), [
    'https://jackalope.dev/tour/',
    'https://jackalope.dev/',
  ]);
  for (const width of [1280, 960, 375]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const isDark of [true, false]) {
      await page.evaluate((dark) => window.setFixtureTheme(dark), isDark);
      await page.emulateMedia({ reducedMotion: isDark ? 'no-preference' : 'reduce' });
      await page.waitForTimeout(350);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.locator('.access-page').evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({
        path: fileURLToPath(new URL(`waitlist-${width}-${isDark ? 'dark' : 'light'}.png`, output)),
      });
      await input.scrollIntoViewIfNeeded();
      const bounds = await input.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    }
  }
  await page.evaluate(() => {
    window.accessFixture.account.state = 'waiting-offline';
    window.accessFixture.account.waitlist.position = 17;
  });
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByText('Last known position').waitFor();
  await page.getByText('#17', { exact: true }).waitFor();
  assert.equal(await workspace.count(), 0);
  await page.evaluate(() => {
    window.accessFixture.account.waitlist.position = null;
    window.accessFixture.copyFails = true;
  });
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByText('Your position is not available yet.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not copy' }).waitFor();
  await page.getByRole('button', { name: 'Disconnect this desktop' }).click();
  await page.getByRole('button', { name: 'Connect account', exact: true }).waitFor();
  assert.equal(await waitlistHeading.count(), 0);
  await page.setViewportSize({ width: 960, height: 640 });
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
    'Account boundary fixtures passed: waitlist pairing, progress, copy, learn links, offline/unknown rank, disconnect, no bypass, approval, revocation, themes, keyboard focus and narrow layouts. No native tasks or real accounts used.',
  );
} finally {
  await browser.close();
}
