import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const output = 'output/growth-redesign';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const sizes = [
  { width: 1280, height: 840 },
  { width: 960, height: 640 },
  { width: 390, height: 844 },
];
const member = {
  email: 'member@example.invalid',
  limit: 5,
  remaining: 3,
  accepted: 1,
  downloaded: 1,
  connected: 1,
  shareUrl: `https://jackalope.dev/access/?invite=${'b'.repeat(64)}`,
  invites: [],
  download: null,
};
for (const size of sizes) {
  const context = await browser.newContext({ viewport: size, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  let signedIn = false;
  let failSurvey = true;
  const requests = [];
  await page.route('https://api.jackalope.test/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const data = request.postDataJSON();
    if (data) requests.push({ path, data });
    let status = 200;
    let body = { success: true };
    if (path.endsWith('/waitlist')) body = { success: true, surveyToken: 'a'.repeat(64) };
    if (path.endsWith('/preferences')) {
      status = failSurvey ? 503 : 200;
      body = failSurvey ? { error: 'temporary' } : { success: true };
      failSurvey = false;
    }
    if (path.endsWith('/me')) {
      status = signedIn ? 200 : 401;
      body = signedIn ? member : { error: 'access_sign_in_required' };
    }
    if (path.endsWith('/devices')) body = [];
    if (path.includes('/invitation/')) body = { available: true };
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
      headers: {
        'access-control-allow-origin': 'http://127.0.0.1:5197',
        'access-control-allow-credentials': 'true',
      },
    });
  });
  await page.goto('http://127.0.0.1:5197/?utm_source=dev&utm_medium=article&utm_campaign=launch');
  await page.evaluate(() => document.fonts.ready);
  for (const dark of [false, true]) {
    if (dark) {
      if (size.width < 700)
        await page
          .getByRole('group', { name: 'Try an appearance' })
          .getByRole('button', { name: 'Dark', exact: true })
          .click();
      else await page.getByRole('button', { name: 'Switch to dark appearance' }).click();
      await page.evaluate(() => scrollTo(0, 0));
    }
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Home overflow',
    );
    await page.screenshot({ path: `${output}/home-${size.width}-${dark ? 'dark' : 'light'}.png` });
  }
  const signup = page.getByRole('form', { name: 'Join the Jackalope waitlist' }).first();
  await signup.getByLabel('Email address', { exact: true }).fill('tester@example.invalid');
  await signup.getByRole('button', { name: 'Join the waitlist' }).click();
  await page.getByRole('heading', { name: 'Make Jackalope fit your work.' }).waitFor();
  const preferences = page.locator('.waitlist-preferences').first();
  await preferences.getByLabel('macOS', { exact: true }).check();
  await preferences.getByLabel('Linux', { exact: true }).check();
  await preferences.getByLabel('Codex', { exact: true }).check();
  await preferences.getByLabel('Reviewing changes', { exact: true }).check();
  await preferences.getByRole('button', { name: 'Save preferences' }).click();
  await preferences.getByText('Couldn’t connect. Please try again.').waitFor();
  assert(
    await preferences.getByLabel('macOS', { exact: true }).isChecked(),
    'Retry lost preferences',
  );
  await preferences.screenshot({ path: `${output}/survey-${size.width}.png` });
  await preferences.getByRole('button', { name: 'Save preferences' }).click();
  await preferences.getByText('Thanks. Help shape what comes next.').waitFor();
  assert.equal(
    requests.find((entry) => entry.path.endsWith('/waitlist')).data.campaign.source,
    'dev',
  );
  assert.deepEqual(
    requests.find((entry) => entry.path.endsWith('/preferences')).data.preferences.platforms,
    ['macos', 'linux'],
  );
  signedIn = true;
  await page.goto('http://127.0.0.1:5197/access/');
  await page.getByRole('heading', { name: 'Your access' }).waitFor();
  await page
    .getByRole('navigation', { name: 'Your account' })
    .getByRole('link', { name: 'Invitations' })
    .click();
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Member overflow',
  );
  await page.screenshot({ path: `${output}/member-${size.width}.png`, fullPage: true });
  await context.close();
}
const context = await browser.newContext({ viewport: sizes[0], reducedMotion: 'reduce' });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const adminHtml = readFileSync(`${output}/admin.html`, 'utf8');
await page.route('http://admin.fixture/**', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/admin/access')
    return route.fulfill({ contentType: 'text/html', body: adminHtml });
  let body = {};
  if (url.pathname.endsWith('/insights'))
    body = {
      totals: { requested: 28, responded: 16, approved: 5, connected: 3 },
      platforms: [
        { label: 'macos', count: 8 },
        { label: 'windows', count: 7 },
        { label: 'linux', count: 4 },
      ],
      agents: [
        { label: 'codex', count: 12 },
        { label: 'claude', count: 10 },
      ],
      priorities: [{ label: 'review', count: 9 }],
      sources: [{ label: 'dev', count: 7 }],
    };
  else if (url.pathname.endsWith('/readiness'))
    body = { enabled: true, mailConfigured: true, download: 'unconfigured' };
  else
    body = {
      counts: [
        { status: 'waiting', count: 23 },
        { status: 'approved', count: 5 },
      ],
      members: [
        {
          id: 'sample',
          email: 'tester@example.invalid',
          status: 'waiting',
          created_at: 1788868800000,
          devices: 0,
          invite_limit: 5,
          mail_state: 'queued',
          mail_kind: 'waitlist',
          preferences: JSON.stringify({
            platforms: ['macos'],
            agents: ['codex'],
            priorities: ['review'],
          }),
        },
      ],
      hasMore: false,
    };
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
});
await page.goto('http://admin.fixture/admin/access');
await page.getByText('16 of 28 people answered', { exact: false }).waitFor();
await page.getByLabel('Platform', { exact: true }).selectOption('macos');
await page.getByLabel('Onboarding stage').selectOption('not-connected');
for (const size of sizes.slice(0, 2)) {
  await page.setViewportSize(size);
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Admin overflow',
    );
    await page.screenshot({
      path: `${output}/admin-${size.width}-${colorScheme}.png`,
      fullPage: true,
    });
  }
}
await browser.close();
assert.deepEqual(errors, [], 'Browser errors');
console.log(
  'Website signup/retry, preferences, campaign attribution, member navigation and admin fixtures pass at wide, narrow and mobile sizes; light/dark and reduced motion checked.',
);
