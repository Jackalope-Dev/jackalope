import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const origin = process.env.JACKALOPE_TEST_URL || 'http://127.0.0.1:5194';
const output = resolve('output/download-page');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL || 'msedge',
  headless: true,
});
const errors = [];
const token = 'a'.repeat(64);

async function open({
  platform = 'Win32',
  userAgent = '',
  maxTouchPoints = 0,
  width = 1280,
  height = 840,
  hash = '',
  signedIn = false,
  acceptStatus = 200,
} = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(
    ({ platform, userAgent, maxTouchPoints }) => {
      Object.defineProperty(navigator, 'platform', { value: platform });
      Object.defineProperty(navigator, 'userAgentData', { value: { platform } });
      if (userAgent) Object.defineProperty(navigator, 'userAgent', { value: userAgent });
      Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints });
    },
    { platform, userAgent, maxTouchPoints },
  );
  let accepted = signedIn;
  let attempts = 0;
  let responseStatus = acceptStatus;
  await context.route('**/v1/access/**', async (route) => {
    const request = route.request();
    const headers = {
      'access-control-allow-origin': new URL(origin).origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/accept')) {
      attempts++;
      assert.deepEqual(request.postDataJSON(), { token });
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (responseStatus !== 200)
        return route.fulfill({
          status: responseStatus,
          headers,
          json: { error: responseStatus === 410 ? 'link_expired' : 'unavailable' },
        });
      accepted = true;
      return route.fulfill({ headers, json: { success: true } });
    }
    if (path.endsWith('/me'))
      return route.fulfill({
        status: accepted ? 200 : 401,
        headers,
        json: accepted
          ? { email: 'accepted@example.test', download: null }
          : { error: 'authentication_required' },
      });
    if (path.endsWith('/status')) return route.fulfill({ headers, json: { enabled: true } });
    throw new Error(`Unexpected access request: ${request.method()} ${path}`);
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydration|hydrating|Minified React/i.test(message.text()))
      errors.push(message.text());
  });
  page.on('download', () => errors.push('Unexpected automatic download'));
  await page.goto(`${origin}/download/${hash}`);
  await page.getByRole('heading', { name: 'Download Jackalope.', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  return {
    context,
    page,
    attempts: () => attempts,
    recover: () => {
      responseStatus = 200;
    },
  };
}

async function noOverflow(page) {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'No horizontal overflow',
  );
}

try {
  for (const [platform, userAgent, expected] of [
    ['Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos'],
    ['Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
  ]) {
    const { page, context, attempts } = await open({ platform, userAgent });
    await page.locator(`[data-platform="${expected}"] .download-detected`).waitFor();
    assert.equal(
      await page.locator('.download-platform').first().getAttribute('data-platform'),
      expected,
    );
    assert.equal(await page.getByText('Coming soon', { exact: true }).count(), 3);
    assert.equal(await page.locator('.download-platform-action a').count(), 0);
    assert.equal(attempts(), 0);
    await noOverflow(page);
    if (expected === 'windows') {
      const join = page
        .locator('main')
        .getByRole('button', { name: 'Join the waitlist', exact: true });
      await join.click();
      await page.getByRole('dialog', { name: 'Join the Jackalope waitlist' }).waitFor();
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Email address', exact: true })
          .evaluate((element) => document.activeElement === element),
        true,
      );
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        (element) => document.activeElement === element,
        await join.elementHandle(),
      );
      await page.screenshot({ path: `${output}/download-1280-light.png`, fullPage: true });
      await page.getByRole('button', { name: 'Switch to dark appearance', exact: true }).click();
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${output}/download-1280-dark.png`, fullPage: true });
      await page.reload();
      await page.getByRole('button', { name: 'Switch to light appearance', exact: true }).waitFor();
    }
    await context.close();
  }

  for (const [width, height, platform, userAgent, maxTouchPoints] of [
    [960, 640, 'Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0],
    [375, 812, 'iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18 like Mac OS X)', 5],
    [768, 1024, 'MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5],
  ]) {
    const { page, context } = await open({ width, height, platform, userAgent, maxTouchPoints });
    await noOverflow(page);
    if (maxTouchPoints)
      assert.equal(
        await page.locator('.download-detected').count(),
        0,
        'Mobile/tablet has no false desktop recommendation',
      );
    await page.screenshot({ path: `${output}/download-${width}-light.png`, fullPage: true });
    await context.close();
  }

  {
    const { page, context, attempts } = await open({ hash: `#token=${token}` });
    const confirm = page.getByRole('button', { name: 'Confirm email', exact: true });
    await confirm.waitFor();
    assert.equal(new URL(page.url()).hash, '', 'Token removed from address before confirmation');
    assert.equal(attempts(), 0, 'Email links are not consumed on a page visit');
    await confirm.dblclick();
    await page.getByRole('heading', { name: 'Your early access is approved.' }).waitFor();
    assert.equal(attempts(), 1, 'Only one exchange on repeated clicks');
    assert.equal(
      await page
        .locator('#download-access-title')
        .evaluate((element) => document.activeElement === element),
      true,
    );
    assert.equal(
      await page.getByText('Coming soon', { exact: true }).count(),
      3,
      'Approval does not invent a release',
    );
    await page.screenshot({ path: `${output}/download-approved.png`, fullPage: true });
    await context.close();
  }
  {
    const { page, context, attempts } = await open({ hash: `#token=${token}`, acceptStatus: 410 });
    await page.getByRole('button', { name: 'Confirm email', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /expired/);
    assert.equal(await page.getByRole('button', { name: 'Confirm email', exact: true }).count(), 0);
    assert.equal(attempts(), 1);
    await context.close();
  }
  {
    const { page, context, recover, attempts } = await open({
      hash: `#token=${token}`,
      acceptStatus: 503,
    });
    await page.getByRole('button', { name: 'Confirm email', exact: true }).click();
    await page.getByRole('alert').waitFor();
    recover();
    await page.getByRole('button', { name: 'Confirm email', exact: true }).click();
    await page.getByRole('heading', { name: 'Your early access is approved.' }).waitFor();
    assert.equal(attempts(), 2);
    await context.close();
  }
  {
    const { page, context, attempts } = await open({ hash: '#token=invalid' });
    await page.getByRole('alert').waitFor();
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.getByRole('button', { name: 'Confirm email', exact: true }).count(), 0);
    assert.equal(attempts(), 0);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Download page browser checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
