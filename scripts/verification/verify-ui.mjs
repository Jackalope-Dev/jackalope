import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from '../../packages/ui/node_modules/vite/dist/node/index.js';
import { verifyPatternLayout, verifyPatterns } from './ui-patterns.mjs';

const output = 'output/ui-library';
mkdirSync(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: 'packages/ui/gallery',
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    channel: process.env.UI_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome'),
    headless: true,
  });
  const address = server.httpServer.address();
  assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('heading', { name: 'One family of controls.' }).waitFor();

  const name = page.getByRole('textbox', { name: 'Project name', exact: true });
  await page.getByRole('button', { name: 'Focus name', exact: true }).click();
  assert(
    await name.evaluate((element) => element === document.activeElement),
    'Input forwards its ref',
  );
  await name.fill('Library test');
  await page.getByRole('button', { name: 'Save example', exact: true }).click();
  assert.match(await page.getByLabel('Submitted values').textContent(), /Submit to inspect/);
  await page.getByRole('checkbox', { name: 'I reviewed the example' }).check();
  const select = page.locator('#forms').getByRole('combobox', { name: 'Digest frequency' });
  await select.click();
  await page.getByRole('option', { name: 'Daily', exact: true }).click();
  await page.getByRole('button', { name: 'Save example', exact: true }).click();
  assert.deepEqual(JSON.parse(await page.getByLabel('Submitted values').textContent()), {
    name: 'Library test',
    email: 'hello@example.invalid',
    summary: 'A little room for big ideas.',
    frequency: 'daily',
    accepted: 'yes',
  });
  await page.getByRole('button', { name: 'Reset native fields' }).click();
  assert.equal(await name.inputValue(), 'Garden studio');
  assert.equal(
    await page.getByRole('checkbox', { name: 'I reviewed the example' }).isChecked(),
    false,
  );
  await page.getByRole('button', { name: 'Toggle field error' }).click();
  assert.equal(await name.getAttribute('aria-invalid'), 'true');
  const description = await name.evaluate((element) =>
    element
      .getAttribute('aria-describedby')
      .split(' ')
      .map((id) => document.getElementById(id).textContent)
      .join(' '),
  );
  assert.match(description, /A name you will recognize later.*Choose a different project name/);
  await page.getByRole('button', { name: 'Toggle field error' }).click();
  const toggle = page.getByRole('switch', { name: 'Notifications' });
  await toggle.focus();
  await page.keyboard.press('Space');
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'Mixed selection' })
      .evaluate((element) => element.indeterminate),
    true,
  );
  await page.getByRole('checkbox', { name: 'Mixed selection' }).click();
  assert.equal(
    await page.getByRole('checkbox', { name: 'Mixed selection', checked: true }).count(),
    1,
    'Mixed checkbox exposes its new checked state after activation',
  );

  const menu = page.getByRole('button', { name: 'Project actions' });
  await menu.focus();
  await page.keyboard.press('ArrowDown');
  const open = page.getByRole('menuitem', { name: 'Open project', exact: true });
  await open.waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Open project');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Show archived');
  assert.equal(
    await page
      .getByRole('menuitemcheckbox', { name: 'Show archived' })
      .evaluate((element) => element === document.activeElement),
    true,
    'Menu skips disabled items',
  );
  await page.keyboard.press('Space');
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent === 'Project actions');
  assert(await menu.evaluate((element) => element === document.activeElement));
  await menu.click();
  assert.equal(
    await page
      .getByRole('menuitemcheckbox', { name: 'Show archived' })
      .getAttribute('aria-checked'),
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View options', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'View options' })
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tabpanel', { name: 'Activity' }).waitFor();
  await page.getByRole('button', { name: 'Active', exact: true }).click();
  assert.equal(await page.getByLabel('Selected filter').textContent(), 'Showing active');

  const trigger = page.getByRole('button', { name: 'Try confirmation' });
  await trigger.click();
  await page.getByRole('dialog', { name: 'Remove this example?' }).waitFor();
  await page.getByRole('button', { name: 'Remove example', exact: true }).evaluate((element) => {
    element.click();
    element.click();
  });
  await page.getByRole('button', { name: 'Removing…' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 1, 'Pending action blocks dismissal');
  assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(
    await page.getByLabel('Confirmation results').textContent(),
    'Attempts: 1 · Completed: 1',
  );
  await page.waitForFunction(() => document.activeElement?.textContent === 'Try confirmation');
  await page.getByRole('checkbox', { name: 'Simulate action failure' }).check();
  await trigger.click();
  await page.getByRole('button', { name: 'Remove example', exact: true }).click();
  await page.getByText('Example action failed. Try again.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 1, 'Failed action remains recoverable');
  assert.equal(
    await page.getByLabel('Confirmation results').textContent(),
    'Attempts: 2 · Completed: 1',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await trigger.click();
  assert.equal(
    await page.getByText('Example action failed. Try again.', { exact: true }).count(),
    0,
    'Reopening clears a previous error',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });

  const copy = page.getByRole('button', { name: 'Copy example', exact: true });
  const copyAnnouncement = await copy.locator('[aria-live="polite"]').elementHandle();
  const idleCopySize = await copy.boundingBox();
  await copy.click();
  const pendingCopy = page.getByRole('button', { name: 'Copying…', exact: true });
  assert(await pendingCopy.isDisabled());
  assert(Math.abs(idleCopySize.width - (await pendingCopy.boundingBox()).width) < 1);
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  assert(await copyAnnouncement.evaluate((element) => element.isConnected));
  assert.equal(await page.getByLabel('Example clipboard').textContent(), 'A sample link');
  await page.getByRole('textbox', { name: 'Text to copy' }).fill('A different link');
  await page.getByRole('button', { name: 'Copy example', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Simulate copy failure' }).check();
  await page.getByRole('button', { name: 'Copy example', exact: true }).click();
  await page
    .getByText('Could not copy. Select the text to copy it manually.', { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel('Example clipboard').textContent(), 'A sample link');
  await page.getByRole('checkbox', { name: 'Simulate copy failure' }).uncheck();
  await page.getByRole('button', { name: 'Copy example', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Example clipboard').textContent(), 'A different link');

  await verifyPatterns(page);
  for (const width of [1280, 960, 375]) {
    for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
      await page.emulateMedia({ reducedMotion: dark ? 'reduce' : 'no-preference' });
      await page.goto(`${origin}/${dark ? '?dark' : ''}`);
      await page.getByRole('heading', { name: 'One family of controls.' }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `No page overflow at ${width}, dark=${dark}`,
      );
      const switchSize = await page.getByRole('switch', { name: 'Dark appearance' }).boundingBox();
      assert(switchSize.width >= 44 && switchSize.height >= 44);
      await verifyPatternLayout(page, dark);
      await page.screenshot({
        path: `${output}/gallery-${width}-${dark ? 'dark' : 'light'}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Project details' });
      await dialog.waitFor();
      const box = await dialog.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width, 'Dialog stays in viewport');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.textContent === 'Open dialog');
      const icon = page.getByRole('button', { name: 'Workspace settings' });
      await icon.evaluate(async (element) => {
        element.scrollIntoView({ block: 'center', behavior: 'instant' });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await icon.focus();
      try {
        await page.getByRole('tooltip', { name: 'Workspace settings' }).waitFor();
      } catch (error) {
        console.error({
          width,
          dark,
          state: await page.evaluate(() => ({
            active: document.activeElement.outerHTML,
            tooltip: document.querySelector('.ui-tooltip')?.outerHTML,
            scrollY,
          })),
        });
        await page.screenshot({ path: `${output}/tooltip-failure.png` });
        throw error;
      }
      assert.equal(
        await icon.evaluate((element) => getComputedStyle(element).outlineStyle),
        'solid',
      );
      if (dark)
        assert.equal(
          await toggle.evaluate(
            (element) =>
              getComputedStyle(element.querySelector('.ui-switch-thumb')).transitionDuration,
          ),
          '0s',
        );
      if (width === 375) {
        const scroll = page.getByRole('region', { name: 'Sample projects' });
        await scroll.focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.querySelector('.ui-table-scroll').scrollLeft > 0);
        assert(
          await scroll.evaluate((element) => element.scrollLeft > 0),
          'Table scrolls with the keyboard',
        );
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Shared UI passed: forms, search, settings, disclosures, loading actions, status labels, keyboard overlays, confirmations, copy recovery, and six responsive/theme views.',
  );
} finally {
  await browser?.close();
  await server.close();
}
