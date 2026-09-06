async function _verifyPage(page) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  await page.goto('http://localhost:5180');
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
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('menuitem', { name: 'The workspace' }).waitFor();
  await page.keyboard.press('Escape');
  assert(
    await page
      .getByRole('button', { name: 'Open navigation' })
      .evaluate((el) => el === document.activeElement),
    'Menu focus return',
  );
  await page.getByRole('tab', { name: '01 Make room for ideas' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: '02 Stay in the loop' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: '03 Bring your agents' }).waitFor();
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
  await page.getByRole('button', { name: 'Windows download status' }).click();
  await page.getByRole('dialog', { name: 'A little more growing room.' }).waitFor();
  await page.keyboard.press('Escape');
  assert(
    await page
      .getByRole('button', { name: 'Windows download status' })
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
    keyboardTabs: true,
    menuAndDialogFocus: true,
    faq: true,
    appearance: true,
    reducedMotion: true,
    media,
    errors,
  };
}
