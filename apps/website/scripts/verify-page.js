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
    const grain = page.locator('.lp-hero .lp-grain');
    assert(
      await grain.evaluate(
        (element) =>
          element.getAttribute('aria-hidden') === 'true' &&
          getComputedStyle(element).pointerEvents === 'none',
      ),
      `Decorative grain does not intercept controls at ${width}`,
    );
    assert(
      await page.evaluate(() => {
        const hero = document.querySelector('.lp-hero');
        return (
          !('motion' in document.querySelector('.lp').dataset) && hero.offsetHeight <= innerHeight
        );
      }),
      `Reduced motion keeps the hero one screen tall at ${width}`,
    );
    for (const title of await page.locator('.lp-card-title a').all()) {
      await title.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
      assert(
        await title.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const text = range.getBoundingClientRect();
          const card = el.closest('.lp-card').getBoundingClientRect();
          return text.left >= card.left && text.right <= card.right;
        }),
        `Card title fits its card at ${width}`,
      );
    }
    for (const id of ['intro', 'inside', 'features', 'questions', 'download']) {
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
  await headerWaitlistButton.click();
  await page.getByRole('dialog', { name: 'Sign up for Jackalope' }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    (button) => document.activeElement === button,
    await headerWaitlistButton.elementHandle(),
  );
  const terminal = page.getByRole('textbox', { name: 'Message the demo agent' });
  await terminal.fill('!git status');
  await terminal.press('Enter');
  await page.locator('.td-transcript').getByText('On branch main').waitFor();
  await terminal.press('Alt+2');
  await page.waitForFunction(
    () => document.querySelectorAll('.td-tab')[1]?.getAttribute('aria-current') === 'true',
  );
  assert(
    await page.locator('.lp-cue').evaluate((el) => getComputedStyle(el).animationName === 'none'),
    'Reduced hero motion',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => 'motion' in document.querySelector('.lp').dataset);
  const scrubHero = (share) =>
    page.locator('.lp-hero').evaluate((el, at) => {
      scrollTo({ top: (el.offsetHeight - innerHeight) * at, behavior: 'instant' });
    }, share);
  const maskOpacity = () =>
    page.locator('.lp-mask').evaluate((el) => Number(getComputedStyle(el).opacity));
  await scrubHero(0);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.lp-mask')).opacity === '1',
  );
  await scrubHero(1);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.lp-mask')).opacity === '0',
  );
  assert((await maskOpacity()) === 0, 'Scrolling zooms through the name onto the field');
  await page.locator('#inside').evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.lp-word')].every((word) => word.classList.contains('is-lit')),
  );
  await page.locator('#features').evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.lp-card')].every((card) =>
      card.classList.contains('is-active'),
    ),
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
