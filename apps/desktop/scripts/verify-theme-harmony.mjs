import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const output = 'output/playwright/theme-harmony';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const choose = async (name) => {
    await page.getByRole('radio', { name, exact: true }).focus();
    await page.keyboard.press('Space');
    assert.ok(await page.getByRole('radio', { name, exact: true }).isChecked());
  };
  const token = (name) =>
    page.evaluate((name) => document.documentElement.style.getPropertyValue(name), name);
  const palette = () => page.getByRole('list', { name: 'Generated palette' }).innerText();
  await page.goto(process.argv[2] ?? 'http://localhost:5173');
  const atmosphere = page.getByRole('slider', { name: 'Atmosphere', exact: true });
  assert.equal(await atmosphere.inputValue(), '12');
  await atmosphere.focus();
  await page.keyboard.press('End');
  assert.equal(await atmosphere.inputValue(), '64');
  const sliderBounds = await atmosphere.boundingBox();
  assert.ok(sliderBounds.height >= 24);
  await atmosphere.click();
  assert.ok(Math.abs(Number(await atmosphere.inputValue()) - 32) <= 1);
  await atmosphere.focus();
  await page.keyboard.press('End');
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: width === 960 ? 'reduce' : 'no-preference' });
    for (const mode of ['Light', 'Dark']) {
      await choose(mode);
      for (const [harmony, count] of [
        ['Single', 1],
        ['Duo', 2],
        ['Trio', 3],
      ]) {
        await choose(harmony);
        assert.equal(
          await page.getByRole('list', { name: 'Generated palette' }).getByRole('listitem').count(),
          count,
        );
        assert.equal(await page.locator('.theme-companion-marker').count(), count - 1);
        assert.equal(await page.locator('.onboarding-privacy-panel').count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page
          .getByRole('heading', { name: 'Choose your theme', exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/onboarding-${harmony}-${mode}-${width}.png` });
        if (harmony === 'Trio') {
          await atmosphere.scrollIntoViewIfNeeded();
          await atmosphere.focus();
          await page.screenshot({ path: `${output}/atmosphere-${mode}-${width}.png` });
        }
      }
    }
  }
  const before = await palette();
  const field = page.getByRole('slider', { name: 'Color field' });
  await field.focus();
  await page.keyboard.press('Shift+ArrowRight');
  assert.notEqual(await palette(), before);
  const fieldBox = await field.boundingBox();
  const beforeDrag = await palette();
  await page.mouse.move(fieldBox.x + fieldBox.width / 2, fieldBox.y + fieldBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(fieldBox.x + fieldBox.width * 0.7, fieldBox.y + fieldBox.height * 0.3, {
    steps: 5,
  });
  await page.mouse.up();
  assert.notEqual(await palette(), beforeDrag);
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  assert.ok(await page.getByRole('radio', { name: 'Trio', exact: true }).isChecked());
  await page.getByRole('button', { name: 'Reset preview', exact: true }).click();
  assert.ok(await page.getByRole('radio', { name: 'Single', exact: true }).isChecked());
  await choose('Trio');
  await page.getByRole('button', { name: 'Keep theme and continue', exact: true }).click();
  const saved = await token('--color-shell-gradient');
  await page.reload();
  assert.equal(await token('--color-shell-gradient'), saved);
  const trigger = page.getByRole('button', { name: 'Personalize your workspace', exact: true });
  await trigger.click();
  await choose('Duo');
  assert.notEqual(await token('--color-shell-gradient'), saved);
  await page.keyboard.press('Escape');
  assert.equal(await token('--color-shell-gradient'), saved);
  assert.ok(await trigger.evaluate((el) => el === document.activeElement));
  await trigger.click();
  await choose('Duo');
  await page.getByRole('button', { name: 'Cancel theme preview', exact: true }).click();
  assert.equal(await token('--color-shell-gradient'), saved);
  await trigger.click();
  await choose('Duo');
  await page.getByRole('button', { name: 'Reset preview', exact: true }).click();
  assert.ok(await page.getByRole('radio', { name: 'Trio', exact: true }).isChecked());
  await choose('Duo');
  await page.getByRole('button', { name: 'Keep theme', exact: true }).click();
  const savedDuo = await token('--color-shell-gradient');
  await page.reload();
  assert.equal(await token('--color-shell-gradient'), savedDuo);
  await trigger.click();
  await choose('Trio');
  await page.getByRole('heading', { name: 'Set up Jackalope', exact: true }).click();
  await trigger.click();
  assert.ok(await page.getByRole('radio', { name: 'Trio', exact: true }).isChecked());
  const box = await page.locator('.workspace-appearance').boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 960 && box.y + box.height <= 640);
  await page.screenshot({ path: `${output}/picker-trio-dark-narrow.png` });
  await page.getByRole('button', { name: 'Zen Rose', exact: true }).click();
  const normalAction = page.getByRole('button', { name: 'Keep theme', exact: true });
  assert.equal(
    await normalAction.evaluate((el) => getComputedStyle(el).color),
    'rgb(255, 255, 255)',
  );
  const selectedHarmony = page
    .locator('.theme-harmony-option')
    .filter({ has: page.getByRole('radio', { name: 'Trio', exact: true }) })
    .locator(':scope > span');
  const selectionShadow = await selectedHarmony.evaluate((el) => getComputedStyle(el).boxShadow);
  assert.ok(selectionShadow !== 'none' && !selectionShadow.includes('inset'));
  await page.screenshot({ path: `${output}/picker-rose-white-label-narrow.png` });
  await page.getByRole('button', { name: 'Rose', exact: true }).click();
  const button = page.getByRole('button', { name: 'Keep theme', exact: true });
  await button.hover();
  await page.waitForTimeout(180);
  const styles = await button.evaluate((el) => ({
    foreground: getComputedStyle(el).color,
    background: getComputedStyle(el).backgroundColor,
    filter: getComputedStyle(el).filter,
  }));
  assert.equal(styles.filter, 'none');
  const lum = (css) =>
    css
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((x) => x / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
  const a = lum(styles.foreground),
    b = lum(styles.background);
  const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert.ok(contrast >= 4.5, `Hovered button contrast ${contrast}`);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      harmonies: 3,
      sizes: 2,
      appearances: 2,
      keyboard: true,
      save: true,
      reload: true,
      cancel: true,
      reset: true,
      outsideSave: true,
      hoverContrast: contrast,
      errors,
    }),
  );
} finally {
  await browser.close();
}
