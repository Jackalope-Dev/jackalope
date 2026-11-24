async function _verifyPage(page) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(await page.evaluate(() => location.origin));
  await page.evaluate(() => document.fonts.ready);
  assert(
    await page.evaluate(
      () => document.documentElement.style.getPropertyValue('--accent-h') === '258',
    ),
    'Default Jackalope Violet theme',
  );
  assert(
    (await page.locator('.landing-kicker, .hero-edition, .echo-caption').count()) === 0,
    'No redundant eyebrow labels',
  );
  assert(
    (await page.locator('.lp-final').getByRole('textbox', { name: 'Email address' }).count()) === 1,
    'Signup form beside the final download link',
  );
  const actions = page.locator('.lp-actions');
  assert(
    (await actions.getByRole('link', { name: 'Download Jackalope' }).getAttribute('href')) ===
      '/download/',
    'Download is the main hero action',
  );
  assert(
    (await actions.getByRole('link', { name: 'View source' }).getAttribute('href'))?.startsWith(
      'https://github.com/',
    ),
    'Source link beside download',
  );
  const xLink = page.getByRole('link', { name: 'Follow on X', exact: true });
  assert(
    (await xLink.getAttribute('href')) === 'https://x.com/JackalopeDotDev',
    'Official X profile link',
  );
  assert((await xLink.getAttribute('rel')) === 'me', 'X profile relationship');
  await xLink.focus();
  assert(await xLink.evaluate((link) => link === document.activeElement), 'X link keyboard focus');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [
    [1440, 1000],
    [1280, 840],
    [960, 640],
    [390, 844],
    [320, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, 0));
    assert(
      await page
        .locator('.lp-backdrop')
        .evaluate((element) => element.getAttribute('aria-hidden') === 'true'),
      `Decorative lanes are hidden from assistive technology at ${width}`,
    );
    assert(
      await page.evaluate(() => {
        const data = document.querySelector('.lp').dataset;
        return !('motion' in data) && !('pinned' in data);
      }),
      `Reduced motion leaves the panes in the page flow at ${width}`,
    );
    for (const pane of await page.locator('.lp-pane').all()) {
      await pane.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
      const box = await pane.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width, `Complete pane at ${width}`);
      assert(
        await pane.evaluate((el) => el.scrollWidth <= el.clientWidth),
        `Pane text fits at ${width}`,
      );
    }
    for (const id of ['how-it-works', 'inside', 'features', 'questions', 'download']) {
      await page.locator(`#${id}`).evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Overflow at ${width}, ${id}`,
      );
    }
  }
  await page.setViewportSize({ width: 1280, height: 840 });
  const appearance = page.locator('.landing-header .appearance-toggle');
  await appearance.click();
  assert(
    await page.evaluate(() => document.documentElement.style.colorScheme === 'dark'),
    'Dark appearance',
  );
  await appearance.click();
  await page.waitForFunction(() => document.documentElement.style.colorScheme === 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('menuitem', { name: 'Product tour' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (button) => document.activeElement === button,
    await page.getByRole('button', { name: 'Open navigation' }).elementHandle(),
  );
  await page.getByText('Do I need an AI subscription?', { exact: true }).focus();
  await page.keyboard.press('Enter');
  assert((await page.locator('#questions details[open]').count()) === 1, 'Keyboard FAQ');
  await page.keyboard.press('Enter');
  const headerWaitlistButton = page
    .locator('.landing-header')
    .getByRole('button', { name: 'Sign up', exact: true });
  // Builds with configured downloads link to the download page instead of offering signup.
  if (await headerWaitlistButton.count()) {
    await headerWaitlistButton.click();
    await page.getByRole('dialog', { name: 'Sign up for Jackalope' }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      (button) => document.activeElement === button,
      await headerWaitlistButton.elementHandle(),
    );
  } else {
    assert(
      (await page
        .locator('.landing-header')
        .getByRole('link', { name: 'Get Jackalope' })
        .getAttribute('href')) === '/download/',
      'Header download link',
    );
  }
  const terminal = page.getByRole('textbox', { name: 'Message the demo agent' });
  await terminal.fill('!git status');
  await terminal.press('Enter');
  await page.locator('.td-transcript').getByText('On branch main').waitFor();
  await terminal.press('Alt+2');
  await page.waitForFunction(
    () => document.querySelectorAll('.td-tab')[1]?.getAttribute('aria-current') === 'true',
  );
  assert(
    await page
      .locator('.lp-line')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration === '0s'),
    'Reduced statement motion',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => 'pinned' in document.querySelector('.lp').dataset);
  const scrubPanes = (share) =>
    page.locator('#inside').evaluate((el, at) => {
      const top = el.getBoundingClientRect().top + scrollY;
      scrollTo({ top: top + (el.offsetHeight - innerHeight) * at, behavior: 'instant' });
    }, share);
  await scrubPanes(0);
  await page.waitForFunction(
    () => document.querySelector('.lp-pane').getBoundingClientRect().left > 0,
  );
  await scrubPanes(1);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.lp-pane')].at(-1).getBoundingClientRect().right <= innerWidth,
  );
  assert(
    await page
      .locator('.lp-pane')
      .first()
      .evaluate((el) => el.getBoundingClientRect().left < 0),
    'Scrolling moves the panes sideways to the last one',
  );
  await page.locator('#features').evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.lp-line')].every((line) => line.classList.contains('is-lit')),
  );
  assert(errors.length === 0, errors.join('\n'));
  return {
    viewports: 5,
    keyboard: true,
    appearance: true,
    reducedMotion: true,
    scrollStory: true,
    terminalDemo: true,
    errors,
  };
}
