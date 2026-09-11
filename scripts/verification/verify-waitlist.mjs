import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { accessAdminPage } from '../../apps/server/src/access/admin-page.ts';
import { accessEmail } from '../../apps/server/src/access/mail-templates.ts';

const output = 'output/waitlist-referrals';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const sizes = [
  { width: 1280, height: 840 },
  { width: 960, height: 640 },
  { width: 390, height: 844 },
];
const failures = [];
const referral = 'b'.repeat(64);
const place = {
  email: 'you@example.invalid',
  status: 'waiting',
  position: 248,
  referrals: 7,
  pending: 2,
  priorityDays: 7,
  shareUrl: `https://jackalope.dev/?ref=${referral}`,
};
const member = {
  email: 'you@example.invalid',
  limit: 5,
  remaining: 3,
  accepted: 1,
  downloaded: 1,
  connected: 0,
  shareUrl: `https://jackalope.dev/access/?invite=${'c'.repeat(64)}`,
  invites: [
    {
      id: 'one',
      email: 'friend@example.invalid',
      status: 'accepted',
      accepted_at: 1,
      downloaded_at: 1,
      connected_at: null,
    },
    {
      id: 'two',
      email: 'another@example.invalid',
      status: 'pending',
      expires_at: Date.now() + 86400000,
    },
  ],
  download: null,
};
const noOverflow = async (page, label) =>
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${label}: overflow`,
  );
try {
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: size,
      reducedMotion: 'reduce',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', (e) => failures.push(e.message));
    let signedIn = true;
    let approved = false;
    let failRefresh = false;
    let accepts = 0;
    const posts = [];
    await page.route('https://api.jackalope.test/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const body = req.postDataJSON();
      if (body) posts.push({ path, body });
      let result = { success: true };
      let status = 200;
      if (path.endsWith('/waitlist/me')) {
        status = failRefresh ? 503 : signedIn ? 200 : 401;
        result = failRefresh
          ? { error: 'access_unavailable' }
          : signedIn
            ? {
                ...place,
                status: approved ? 'approved' : 'waiting',
                position: approved ? null : 248,
              }
            : { error: 'access_sign_in_required' };
      } else if (path.endsWith('/waitlist/accept')) {
        accepts++;
        signedIn = true;
      } else if (path.endsWith('/waitlist/logout')) signedIn = false;
      else if (path.endsWith('/waitlist')) result = { success: true, surveyToken: 'a'.repeat(64) };
      else if (path.endsWith('/me')) result = member;
      else if (path.endsWith('/devices')) result = [];
      else if (path.includes('/invitation/')) result = { available: true };
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(result),
        headers: {
          'access-control-allow-origin': 'http://127.0.0.1:5198',
          'access-control-allow-credentials': 'true',
        },
      });
    });
    await page.goto(`http://127.0.0.1:5198/?ref=${referral}`);
    await page.goto('http://127.0.0.1:5198/tour/');
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem('jackalope-waitlist-ref')),
      referral,
    );
    await page.goto('http://127.0.0.1:5198/waitlist/');
    await page.getByText('#248', { exact: true }).waitFor();
    for (const dark of [false, true]) {
      if (dark) {
        const toggle = page.getByRole('button', { name: 'Switch to dark appearance' });
        if (await toggle.isVisible()) await toggle.click();
        else {
          await page.getByRole('button', { name: 'Open navigation' }).click();
          await page.getByRole('menuitem', { name: /dark appearance/ }).click();
        }
      }
      await noOverflow(page, 'Waitlist');
      await page.screenshot({
        path: `${output}/waitlist-${size.width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
    }
    const copy = page.getByRole('button', { name: 'Copy link', exact: true });
    await copy.focus();
    await page.keyboard.press('Enter');
    // The confirmation lands on the button itself and clears after a couple of
    // seconds, so read it before touching the clipboard.
    const copied = page.getByRole('button', { name: 'Copied', exact: true });
    await copied.waitFor();
    assert.notEqual(await copied.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), place.shareUrl);
    failRefresh = true;
    await page.getByRole('button', { name: 'Refresh my place' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByText('#248', { exact: true }).count(), 1);
    failRefresh = false;
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Email address', { exact: true }).fill('you@example.invalid');
    await page.getByRole('button', { name: 'Email my private link' }).click();
    await page.getByRole('heading', { name: 'Check your inbox.' }).waitFor();
    await page.goto(`http://127.0.0.1:5198/waitlist/#token=${'a'.repeat(64)}`);
    await page.getByRole('button', { name: 'Confirm email & see my place' }).waitFor();
    assert(!page.url().includes('#token='));
    assert.equal(accepts, 0);
    await page.getByRole('button', { name: 'Confirm email & see my place' }).click();
    await page.getByText('#248', { exact: true }).waitFor();
    assert.equal(accepts, 1);
    approved = true;
    await page.reload();
    await page.getByRole('link', { name: 'Open my passes' }).waitFor();
    await page.goto('http://127.0.0.1:5198/access/#invitations');
    await page.getByRole('heading', { name: 'Bring your people.' }).waitFor();
    assert.equal(await page.locator('.brand-pass-tickets li').count(), 5);
    assert.equal(await page.locator('.brand-pass-tickets [data-state=Available]').count(), 3);
    for (const dark of [false, true]) {
      if (dark) {
        const toggle = page.getByRole('button', { name: 'Switch to dark appearance' });
        if (await toggle.isVisible()) await toggle.click();
        else {
          await page.getByRole('button', { name: 'Open navigation' }).click();
          await page.getByRole('menuitem', { name: /dark appearance/ }).click();
        }
      }
      await noOverflow(page, 'Passes');
      await page.evaluate(() => {
        document.activeElement?.blur();
        scrollTo(0, 0);
      });
      await page.screenshot({
        path: `${output}/passes-${size.width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
    }
    assert(posts.some((x) => x.path.endsWith('/waitlist/link')));
    await context.close();
  }
  const context = await browser.newContext({ viewport: sizes[0], reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (e) => failures.push(e.message));
  const admin = accessAdminPage('fixture');
  writeFileSync(`${output}/admin.html`, admin);
  await page.route('http://admin.fixture/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/access')
      return route.fulfill({ contentType: 'text/html', body: admin });
    const result = url.pathname.endsWith('/readiness')
      ? { enabled: true, mailConfigured: true, download: 'unconfigured' }
      : url.pathname.endsWith('/insights')
        ? {
            totals: { requested: 28, responded: 16, approved: 5, connected: 3 },
            platforms: [],
            agents: [],
            priorities: [],
            sources: [],
          }
        : {
            members: [
              {
                id: 'fixture',
                email: 'builder@example.invalid',
                status: 'waiting',
                position: 3,
                referral_count: 12,
                pending_referrals: 2,
                accepted: 0,
                created_at: Date.now(),
                invite_limit: 5,
              },
            ],
            counts: [{ status: 'waiting', count: 28 }],
            hasMore: false,
          };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto('http://admin.fixture/admin/access');
  await page.getByText(/12 verified referrals/).waitFor();
  await page.getByLabel('Order', { exact: true }).selectOption('referrals');
  for (const size of sizes.slice(0, 2)) {
    await page.setViewportSize(size);
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await noOverflow(page, 'Admin');
      await page.screenshot({
        path: `${output}/admin-${size.width}-${colorScheme}.png`,
        fullPage: true,
      });
    }
  }
  await context.close();
  const emailContext = await browser.newContext();
  const emailPage = await emailContext.newPage();
  for (const kind of [
    'waitlist',
    'welcome',
    'invite',
    'login',
    'referral',
    'passes_ready',
    'pass_claimed',
    'pass_expired',
  ]) {
    const mail =
      kind === 'waitlist'
        ? { kind, to: 'fixture@example.invalid', token: 'preview-only' }
        : ['welcome', 'invite', 'login'].includes(kind)
          ? { kind, to: 'fixture@example.invalid', token: 'preview-only' }
          : { kind, to: 'fixture@example.invalid', total: 5 };
    const rendered = accessEmail(mail, 'https://jackalope.dev');
    writeFileSync(`${output}/email-${kind}.html`, rendered.body);
    await emailPage.route('https://jackalope.dev/icon-128.png', (route) =>
      route.fulfill({ path: 'apps/website/dist/icon-128.png' }),
    );
    await emailPage.setContent(rendered.body);
    for (const width of [640, 390]) {
      await emailPage.setViewportSize({ width, height: 900 });
      await noOverflow(emailPage, `Email ${kind}`);
      await emailPage.screenshot({ path: `${output}/email-${kind}-${width}.png`, fullPage: true });
    }
  }
  await emailContext.close();
  assert.deepEqual(failures, []);
  console.log(
    'Waitlist, pass, admin, and eight email fixtures passed: 1280/960/390px, both themes, reduced motion, keyboard copy, verification, recovery, and overflow.',
  );
} finally {
  await browser.close();
}
