async function _verifyPage(page) {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(await page.evaluate(() => location.origin));
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const chapters = ['idea', 'context', 'parallel', 'review'];
  for (const [width, height] of [
    [1440, 1000],
    [1280, 840],
    [960, 640],
    [390, 844],
    [320, 720],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [index, chapter] of chapters.entries()) {
      await page.locator(`#chapter-${chapter}`).evaluate((el) => el.scrollIntoView());
      await page.waitForFunction(
        (value) =>
          document.querySelector('.thread-visual')?.getAttribute('data-phase') === String(value),
        index,
      );
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Overflow at ${width}, ${chapter}`,
      );
      const geometry = await page.locator('.story-stage').boundingBox();
      assert(
        geometry.y >= 0 && geometry.y + geometry.height <= height,
        `Sticky stage visible at ${width}, ${chapter}`,
      );
    }
    for (const index of [2, 1, 0]) {
      await page
        .getByRole('navigation', { name: 'Story chapters' })
        .getByRole('link')
        .nth(index)
        .click();
      await page.waitForFunction(
        (value) =>
          document.querySelector('.thread-visual')?.getAttribute('data-phase') === String(value),
        index,
      );
    }
  }
  for (const [label, task, file] of [
    ['Ship a feature', 'Build keyboard search', 'Search.tsx'],
    ['Untangle a bug', 'Keep unfinished drafts', 'TaskComposer.tsx'],
    ['Try a bigger idea', 'Explore navigation', 'Navigation.tsx'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.locator('#chapter-parallel').evaluate((el) => el.scrollIntoView());
    await page.getByRole('heading', { name: task, exact: true }).waitFor();
    await page.locator('#chapter-review').evaluate((el) => el.scrollIntoView());
    await page.locator('.review-art-file').getByText(file, { exact: false }).waitFor();
  }
  await page.getByRole('link', { name: 'Skip to the actual app' }).click();
  await page.getByRole('tab', { name: 'Tasks & ideas' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Review & checks' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Coding agents' }).waitFor();
  await page.getByRole('button', { name: 'Electric Indigo', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  assert(
    await page.evaluate(() => document.documentElement.style.colorScheme === 'dark'),
    'Dark appearance',
  );
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  const emblem = page.getByRole('link', { name: 'Explore the Jackalope workflow', exact: true });
  await emblem.focus();
  await page.keyboard.press('Enter');
  assert(await page.evaluate(() => location.hash === '#workflow'), 'Keyboard logo navigation');
  assert(
    (await page.locator('.brand-emblem mask, .brand-emblem ellipse').count()) === 0,
    'Clean logo silhouette',
  );
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('menuitem', { name: 'How it works' }).waitFor();
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
  await page.getByRole('button', { name: 'Join waitlist', exact: true }).click();
  await page.getByRole('dialog', { name: 'Join the Jackalope waitlist' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Join waitlist');
  await page.getByRole('button', { name: 'Play the Jackalope product walkthrough' }).click();
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
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute('aria-label') ===
      'Play the Jackalope product walkthrough',
  );
  await page.route('**/media/walkthrough.webm', (route) => route.abort());
  await page.getByRole('button', { name: 'Play the Jackalope product walkthrough' }).click();
  await page.getByText('The walkthrough couldn’t load.', { exact: false }).waitFor();
  await page.keyboard.press('Escape');
  await page.unroute('**/media/walkthrough.webm');
  assert(
    await page
      .locator('.thread-scene')
      .evaluate((el) => getComputedStyle(el).animationName === 'none'),
    'Reduced scene motion',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page
    .locator('#chapter-context')
    .evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
  await page.waitForFunction(
    () => document.querySelector('.thread-visual')?.getAttribute('data-phase') === '1',
  );
  assert(
    await page
      .locator('.thread-scene')
      .evaluate((el) => getComputedStyle(el).animationName === 'scene-unfold'),
    'Normal scene motion',
  );
  assert(errors.length === 0, errors.join('\n'));
  return {
    viewports: 5,
    scrollChapters: 4,
    reverseNavigation: true,
    useCases: 3,
    keyboard: true,
    logoNavigation: true,
    appearance: true,
    reducedMotion: true,
    media,
    errors,
  };
}
