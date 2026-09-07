async function _verifyLaunch(page) {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const origin = await page.evaluate(() => location.origin);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /hydration|hydrating|Minified React error/i.test(message.text())
    )
      errors.push(message.text());
  });
  const paths = [
    '/',
    '/tour/',
    '/blog/',
    '/changelog/',
    '/privacy/',
    '/blog/room-for-the-work/',
    '/blog/from-brief-to-review/',
    '/blog/work-and-personal-accounts/',
  ];
  for (const path of paths) {
    const response = await page.goto(origin + path);
    assert(response.status() === 200, `Page status: ${path}`);
    const source = await response.text();
    assert(
      source.includes('<h1') && source.includes('Jackalope Digital LLC'),
      `Prerendered content: ${path}`,
    );
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert((await page.getByRole('heading', { level: 1 }).count()) === 1, `One h1: ${path}`);
    assert(
      (await page.locator('link[rel="canonical"]').getAttribute('href')) ===
        `https://jackalope.dev${path}`,
      `Canonical: ${path}`,
    );
    assert(
      (await page.locator('meta[property="og:title"]').getAttribute('content')) ===
        (await page.title()),
      `Social title: ${path}`,
    );
    const graph = JSON.parse(
      await page.locator('script[type="application/ld+json"]').textContent(),
    );
    assert(
      graph['@graph'].some((entry) => entry['@type'] === 'WebSite'),
      `Structured data: ${path}`,
    );
    if (path === '/tour/') {
      assert(
        graph['@graph'].some((entry) => entry['@type'] === 'VideoObject'),
        'Video metadata',
      );
      assert((await page.locator('video[controls]').count()) === 1, 'Visible tour video');
    }
    for (const width of [1280, 960, 390, 320]) {
      await page.setViewportSize({ width, height: 840 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Overflow: ${path}, ${width}`,
      );
    }
  }
  await page.goto(`${origin}/`);
  let submissions = 0;
  let reply = 'rate';
  await page.route('https://api.sequenzy.com/api/v1/forms/**', async (route) => {
    submissions++;
    if (reply === 'offline') return route.abort();
    await route.fulfill({
      status: reply === 'success' ? 200 : 429,
      contentType: 'application/json',
      body: JSON.stringify(reply === 'success' ? { success: true } : { success: false }),
    });
  });
  await page.getByRole('button', { name: 'Join waitlist', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Something good is taking shape.' });
  const input = dialog.getByRole('textbox', { name: 'Email address' });
  const submit = dialog.getByRole('button', { name: 'Join the waitlist', exact: true });
  await input.fill('not-an-email');
  await submit.click();
  assert(submissions === 0, 'Invalid email must not submit');
  await input.fill('browser-check@example.com');
  await submit.click();
  await dialog.getByRole('alert').waitFor();
  assert(
    (await dialog.getByRole('alert').textContent()).includes('too many'),
    'Rate-limit feedback',
  );
  assert((await input.inputValue()) === 'browser-check@example.com', 'Keep email for retry');
  reply = 'offline';
  await submit.click();
  await page.waitForFunction(() =>
    document.querySelector('[role="alert"]')?.textContent.includes('connection'),
  );
  reply = 'success';
  await submit.click();
  await dialog.getByRole('status').waitFor();
  assert((await dialog.getByRole('form').count()) === 0, 'Success replaces form');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Join waitlist');
  await page.unroute('https://api.sequenzy.com/api/v1/forms/**');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto'),
    'Reduced motion',
  );
  const discovery = await page.evaluate(async () => {
    const paths = [
      '/favicon.svg',
      '/favicon-32.png',
      '/icon-128.png',
      '/icon-256.png',
      '/site.webmanifest',
      '/robots.txt',
      '/sitemap.xml',
      '/llms.txt',
      '/llms-full.txt',
      '/feed.xml',
    ];
    return Promise.all(
      paths.map(async (path) => {
        const response = await fetch(path);
        return { path, status: response.status, type: response.headers.get('content-type') };
      }),
    );
  });
  assert(
    discovery.every((item) => item.status === 200 && !item.type.includes('text/html')),
    'Discovery files must be real assets',
  );
  assert(errors.length === 0, errors.join('\n'));
  return {
    routes: paths.length,
    viewportsPerRoute: 4,
    signupValidation: true,
    errorRecovery: true,
    focusReturn: true,
    reducedMotion: true,
    hydrationErrors: errors,
    discovery,
  };
}
