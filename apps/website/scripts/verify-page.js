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
      () => document.documentElement.style.getPropertyValue('--accent-h') === '245',
    ),
    'Default Indigo theme',
  );
  assert(
    (await page.locator('.landing-kicker, .hero-edition, .echo-caption').count()) === 0,
    'No redundant eyebrow labels',
  );
  assert(
    (await page.locator('.lp-final').getByRole('textbox', { name: 'Email address' }).count()) === 1,
    'Signup form beside the final download link',
  );
  const heroWaitlist = page
    .locator('.lp-actions')
    .getByRole('button', { name: 'Join the waitlist' });
  await heroWaitlist.click();
  await page.getByRole('dialog', { name: 'Join the Jackalope waitlist' }).waitFor();
  await page.getByRole('textbox', { name: 'Email address', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.closest('.lp-actions'));
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
    const logo = page.locator('.lp-hero-echo');
    assert(
      await logo.evaluate(
        (element) =>
          element.getAttribute('aria-hidden') === 'true' &&
          getComputedStyle(element).pointerEvents === 'none',
      ),
      `Decorative background does not intercept controls at ${width}`,
    );
    const visual = await page.locator('.lp-flow').boundingBox();
    assert(
      visual.x >= 0 && visual.x + visual.width <= width,
      `Complete hero illustration at ${width}`,
    );
    assert(
      (await page.locator('.lp-flow').getAttribute('data-step')) === '4',
      `Reduced motion shows the finished illustration at ${width}`,
    );
    for (const id of ['how-it-works', 'inside', 'features', 'questions', 'download']) {
      await page.locator(`#${id}`).evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Overflow at ${width}, ${id}`,
      );
    }
    for (const label of ['Tasks', 'Review', 'Agents', 'Context', 'Schedules']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      await page.getByRole('tabpanel', { name: label }).locator('.product-capture').waitFor();
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Workspace overflow at ${width}: ${label}`,
      );
    }
  }
  await page.getByRole('tab', { name: 'Tasks', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Review' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Agents' }).waitFor();
  await page.setViewportSize({ width: 1280, height: 840 });
  const appearance = page.locator('.landing-header .appearance-toggle');
  await appearance.click();
  assert(
    await page.evaluate(() => document.documentElement.style.colorScheme === 'dark'),
    'Dark appearance',
  );
  await page.waitForFunction(
    () =>
      document.querySelector('.product-capture img')?.getAttribute('src') ===
      '/media/workspace/agents.jpg',
  );
  await appearance.click();
  await page.waitForFunction(
    () =>
      document.querySelector('.product-capture img')?.getAttribute('src') ===
      '/media/workspace/agents-light.jpg',
  );
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
    .getByRole('button', { name: 'Join waitlist', exact: true });
  await headerWaitlistButton.click();
  await page.getByRole('dialog', { name: 'Join the Jackalope waitlist' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (button) => document.activeElement === button,
    await headerWaitlistButton.elementHandle(),
  );
  const play = page.getByRole('button', { name: /^Watch the \d+-second tour$/ });
  await play.click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  const media = await page.locator('video').evaluate(async (video) => {
    video.muted = true;
    await video.play();
    const playing = !video.paused;
    video.pause();
    return {
      playing,
      width: video.videoWidth,
      height: video.videoHeight,
      source: video.currentSrc,
    };
  });
  assert(media.playing, 'Video playback');
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (button) => document.activeElement === button,
    await play.elementHandle(),
  );
  assert(Boolean(media.source), 'Active tour source');
  await page.route(media.source, (route) => route.abort());
  await play.click();
  await page.getByText('The walkthrough couldn’t load.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Explore the workspace', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.unroute(media.source);
  assert(
    await page
      .locator('.lp-explorer [role="tabpanel"][data-state="active"]')
      .evaluate((el) => getComputedStyle(el).animationName === 'none'),
    'Reduced scene motion',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  const flow = page.locator('.lp-flow');
  const step = await flow.getAttribute('data-step');
  await page.waitForFunction(
    (before) => document.querySelector('.lp-flow').dataset.step !== before,
    step,
  );
  await page.locator('#questions').evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(1500);
  const offscreen = await flow.getAttribute('data-step');
  await page.waitForTimeout(1500);
  assert(
    offscreen === '4' && (await flow.getAttribute('data-step')) === '4',
    'Hero illustration pauses offscreen',
  );
  assert(errors.length === 0, errors.join('\n'));
  return {
    viewports: 5,
    workspaceScenes: 5,
    keyboard: true,
    appearance: true,
    reducedMotion: true,
    loopingArtwork: true,
    media,
    errors,
  };
}
