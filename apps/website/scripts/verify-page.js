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
    const logo = await page.locator('.hero-poster .echo-art').boundingBox();
    assert(
      logo.x >= 0 && logo.x + logo.width <= width && logo.y >= 0,
      `Visible hero mark at ${width}`,
    );
    for (const id of ['inside', 'workflow', 'features', 'atmosphere', 'questions', 'download']) {
      await page.locator(`#${id}`).evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Overflow at ${width}, ${id}`,
      );
    }
    for (const [label, task, file] of [
      ['Build a feature', 'Build keyboard search', 'Search.tsx'],
      ['Find a stubborn bug', 'Investigate lost drafts', 'TaskComposer.tsx'],
      ['Explore a new direction', 'Explore navigation', 'Navigation.tsx'],
    ]) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      const panel = page.getByRole('tabpanel', { name: label, exact: true });
      await panel.getByText(task, { exact: true }).waitFor();
      await panel.getByText(file, { exact: false }).waitFor();
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Use case overflow at ${width}: ${label}`,
      );
    }
  }
  await page.getByRole('tab', { name: 'Tasks & ideas' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Changes & review' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Agents & accounts' }).waitFor();
  await page.getByRole('tab', { name: 'Build a feature', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Find a stubborn bug', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Electric Indigo', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  assert(
    await page.evaluate(() => document.documentElement.style.colorScheme === 'dark'),
    'Dark appearance',
  );
  assert(
    (await page.locator('.product-capture img').getAttribute('src')) === '/media/agents.png',
    'Dark app screenshot',
  );
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  assert(
    (await page.locator('.product-capture img').getAttribute('src')) === '/media/agents-light.png',
    'Light app screenshot',
  );
  assert(
    await page
      .locator('.landing-finale')
      .evaluate(
        (el) =>
          getComputedStyle(el).backgroundColor ===
          getComputedStyle(document.querySelector('.landing-footer')).backgroundColor,
      ),
    'Continuous footer color',
  );
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('menuitem', { name: 'Product tour' }).waitFor();
  await page.keyboard.press('Escape');
  assert(
    await page
      .getByRole('button', { name: 'Open navigation' })
      .evaluate((el) => el === document.activeElement),
    'Menu focus return',
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
  await headerWaitlistButton.evaluate((button) => {
    if (document.activeElement !== button) {
      throw new Error('Waitlist dialog did not return focus to its header trigger.');
    }
  });
  const play = page.getByRole('button', { name: 'Watch the app', exact: true });
  await play.click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  const media = await page.locator('video').evaluate(async (video) => {
    video.muted = true;
    await video.play();
    const playing = !video.paused;
    video.pause();
    return { playing, width: video.videoWidth, height: video.videoHeight };
  });
  assert(media.playing, 'Video playback');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Watch the app');
  await page.route('**/media/walkthrough.webm', (route) => route.abort());
  await play.click();
  await page.getByText('The walkthrough couldn’t load.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Explore the workspace', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.unroute('**/media/walkthrough.webm');
  assert(
    await page
      .locator('.workbench [role="tabpanel"][data-state="active"]')
      .evaluate((el) => getComputedStyle(el).animationName === 'none'),
    'Reduced scene motion',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  const line = page.locator('.brand-echo-line').first();
  const transform = await line.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForFunction(
    (before) => getComputedStyle(document.querySelector('.brand-echo-line')).transform !== before,
    transform,
  );
  assert(
    (await page.locator('.echo-art button').count()) === 0,
    'No manual logo animation control',
  );
  await page.locator('#features').evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
  await page.waitForFunction(
    () => document.querySelector('.echo-art .brand-echo').dataset.animated === 'false',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(
    await line.evaluate((el) => getComputedStyle(el).animationName === 'none'),
    'Reduced motion stops logo loop',
  );
  await page.goto(`${await page.evaluate(() => location.origin)}/#agents`);
  await page.locator('#agents').waitFor({ state: 'visible' });
  assert(errors.length === 0, errors.join('\n'));
  return {
    viewports: 5,
    useCases: 3,
    keyboard: true,
    appearance: true,
    reducedMotion: true,
    loopingArtwork: true,
    supportDeepLink: true,
    media,
    errors,
  };
}
