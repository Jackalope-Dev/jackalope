async function _verifyPage(page) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  await page.goto(await page.evaluate(() => location.origin));
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [width, height] of [
    [1440, 1000],
    [1280, 840],
    [960, 640],
    [390, 844],
    [320, 720],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of ['Start with an idea', 'Give it room to run', 'Keep the final say']) {
      await page.getByRole('tab', { name: new RegExp(name) }).click();
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Overflow at ${width}: ${name}`,
      );
    }
  }
  for (const [scenario, title, file] of [
    ['Build a feature', 'Make search feel effortless.', 'src/components/Search.tsx'],
    [
      'Fix a rough edge',
      'Keep the good ideas, even after a refresh.',
      'src/components/TaskComposer.tsx',
    ],
    ['Polish the details', 'Give every theme a little more care.', 'src/components/Settings.css'],
  ]) {
    await page.getByRole('button', { name: scenario, exact: true }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Grok', exact: true }).click();
    await page.getByRole('button', { name: 'Explore parallel work' }).click();
    await page.getByText('Grok · worktree 01', { exact: true }).waitFor();
    assert(
      await page
        .getByRole('tab', { name: /Give it room to run/ })
        .evaluate((el) => el === document.activeElement),
      'Forward navigation preserves keyboard focus',
    );
    await page.keyboard.press('ArrowRight');
    await page
      .getByRole('region', { name: 'Illustrative code patch' })
      .getByText(file, { exact: false })
      .waitFor();
    await page.getByRole('button', { name: 'I want to build like this' }).click();
    await page.getByRole('dialog', { name: 'Join the Jackalope waitlist' }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.activeElement?.textContent === 'I want to build like this',
    );
    assert(
      await page
        .getByRole('button', { name: 'I want to build like this' })
        .evaluate((el) => el === document.activeElement),
      'Demo signup focus return',
    );
    await page.getByRole('button', { name: 'Try another idea' }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('menuitem', { name: 'How it works' }).waitFor();
  await page.keyboard.press('Escape');
  assert(
    await page
      .getByRole('button', { name: 'Open navigation' })
      .evaluate((el) => el === document.activeElement),
    'Menu focus return',
  );
  await page.getByRole('tab', { name: 'Tasks & ideas' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Review & checks' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Coding agents' }).waitFor();
  await page.getByRole('button', { name: 'Electric Indigo', exact: true }).click();
  assert(
    (await page
      .getByRole('button', { name: 'Electric Indigo', exact: true })
      .getAttribute('aria-pressed')) === 'true',
    'Palette selection',
  );
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  assert(
    await page.evaluate(() => document.documentElement.style.colorScheme === 'dark'),
    'Dark theme',
  );
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  await page.getByText('Do I need an AI subscription?', { exact: true }).focus();
  await page.keyboard.press('Enter');
  assert((await page.locator('details[open]').count()) === 1, 'Keyboard FAQ disclosure');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Join waitlist', exact: true }).click();
  await page.getByRole('dialog', { name: 'Join the Jackalope waitlist' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Join waitlist');
  assert(
    await page
      .getByRole('button', { name: 'Join waitlist', exact: true })
      .evaluate((el) => el === document.activeElement),
    'Download focus return',
  );
  await page.getByRole('button', { name: 'See it in motion' }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video && video.readyState >= 1 && video.videoWidth > 0;
  });
  const media = await page.locator('video').evaluate(async (video) => {
    video.muted = true;
    await video.play();
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      playing: !video.paused,
    };
  });
  assert(media.playing, 'Video playback');
  await page.locator('video').evaluate((video) => video.pause());
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.activeElement?.textContent.trim() === 'See it in motion',
  );
  assert(
    await page
      .getByRole('button', { name: 'See it in motion' })
      .evaluate((el) => el === document.activeElement),
    'Video focus return',
  );
  await page.route('**/media/walkthrough.webm', (route) => route.abort());
  await page.getByRole('button', { name: 'Play the Jackalope product walkthrough' }).click();
  await page
    .getByText('The walkthrough couldn’t load.', { exact: false })
    .waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute('aria-label') ===
      'Play the Jackalope product walkthrough',
  );
  assert(
    await page
      .getByRole('button', { name: 'Play the Jackalope product walkthrough' })
      .evaluate((el) => el === document.activeElement),
    'Screenshot focus return',
  );
  await page.unroute('**/media/walkthrough.webm');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto'),
    'Reduced motion scrolling',
  );
  assert(errors.length === 0, errors.join('\n'));
  return {
    viewports: 5,
    interactiveDemo: 'Three scenarios, agent selection, step navigation, reset and signup',
    keyboardTabs: true,
    menuAndDialogFocus: true,
    faq: true,
    appearance: true,
    reducedMotion: true,
    media,
    errors,
  };
}
