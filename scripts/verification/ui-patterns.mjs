import assert from 'node:assert/strict';

export async function verifyPatterns(page) {
  const search = page.getByRole('searchbox', { name: 'Search the example workspace' });
  await page.getByRole('button', { name: 'Focus search', exact: true }).click();
  assert(await search.evaluate((element) => element === document.activeElement));
  const description = await search.getAttribute('aria-describedby');
  assert.equal(
    await page.locator(`[id="${description}"]`).textContent(),
    'Find a project, task, or person.',
  );
  await page.getByRole('button', { name: 'Run search', exact: true }).click();
  assert(await search.evaluate((element) => element.validity.valueMissing));
  await search.fill('Garden studio');
  await search.press('Enter');
  assert.equal(await page.getByLabel('Search submission').textContent(), 'Garden studio');
  await page.getByRole('button', { name: 'Clear workspace search' }).press('Enter');
  assert.equal(await search.inputValue(), '');
  assert(await search.evaluate((element) => element === document.activeElement));
  await search.fill('Saved query');
  await page.getByRole('checkbox', { name: 'Read-only search' }).check();
  assert(await search.evaluate((element) => element.readOnly));
  assert.equal(await page.getByRole('button', { name: 'Clear workspace search' }).count(), 0);
  await page.getByRole('checkbox', { name: 'Read-only search' }).uncheck();
  await page.getByRole('checkbox', { name: 'Disable search' }).check();
  assert(await search.isDisabled());
  assert(await page.getByRole('button', { name: 'Clear workspace search' }).isDisabled());
  await page.getByRole('checkbox', { name: 'Disable search' }).uncheck();
  await page.getByRole('button', { name: 'Reset search', exact: true }).click();
  assert.equal(await search.inputValue(), '');

  const updates = page.getByRole('switch', { name: 'Product updates' });
  await page.locator('label[for="gallery-newsletter"]').click();
  assert.equal(await updates.getAttribute('aria-checked'), 'false');
  const digest = page.locator('#patterns').getByRole('combobox', { name: 'Digest frequency' });
  await digest.click();
  await page.getByRole('option', { name: 'Monthly', exact: true }).click();
  assert.equal((await digest.textContent()).trim(), 'Monthly');

  const summary = page
    .locator('#patterns summary')
    .filter({ hasText: 'How are these controls shared?' });
  await summary.focus();
  await summary.press('Enter');
  await page
    .getByText('Desktop, website, and admin use the same controls with their own data and actions.')
    .waitFor();
  const nested = page.locator('#patterns summary').filter({ hasText: 'Can sections be nested?' });
  await nested.press('Space');
  assert(await nested.evaluate((element) => element.parentElement.open));
  assert(await summary.evaluate((element) => element.parentElement.open));
  await summary.press('Space');
  assert.equal(await summary.evaluate((element) => element.parentElement.open), false);

  const save = page.getByRole('button', { name: 'Save preferences', exact: true });
  await page.evaluate(() => document.fonts.ready);
  const idleSize = await save.boundingBox();
  await save.click();
  const pending = page.getByRole('button', { name: 'Saving preferences…', exact: true });
  assert(await pending.isDisabled());
  assert.equal(await pending.getAttribute('aria-busy'), 'true');
  const busySize = await pending.boundingBox();
  assert(Math.abs(idleSize.width - busySize.width) < 1, 'Busy buttons retain their width');
  assert.equal(idleSize.height, busySize.height);
  await pending.evaluate((element) => element.click());
  await page.getByText('1 example saves completed.', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Simulate save failure' }).check();
  await save.click();
  await page.getByText('The example could not save. Try again.', { exact: true }).waitFor();
  assert(await save.isEnabled());
  await page.getByRole('checkbox', { name: 'Simulate save failure' }).uncheck();
  await save.click();
  await page.getByText('2 example saves completed.', { exact: true }).waitFor();
  assert.equal(
    await page.getByText('The example could not save. Try again.', { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole('img', { name: 'Mail icon at 16px' }).getAttribute('width'),
    '16',
  );
}

export async function verifyPatternLayout(page, reducedMotion) {
  const badges = await page
    .locator('#data .ui-badge, #patterns .ui-badge')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return {
          text: element.textContent,
          textHeight: range.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
        };
      }),
    );
  assert(
    badges.every((badge) => badge.textHeight <= badge.lineHeight),
    'Short status labels stay on one line',
  );
  const search = page.getByRole('searchbox', { name: 'Search the example workspace' });
  await search.fill('A long search to check room beside the clear button');
  const clear = page.getByRole('button', { name: 'Clear workspace search' });
  const box = await clear.boundingBox();
  assert(box.width >= 44 && box.height >= 44, 'Search clear action has a comfortable target');
  assert(
    await search.evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).paddingRight) >= 44,
    ),
    'Search text leaves room for its clear action',
  );
  if (reducedMotion) {
    const save = page.getByRole('button', { name: 'Save preferences', exact: true });
    await save.click();
    const pending = page.getByRole('button', { name: 'Saving preferences…', exact: true });
    assert.equal(
      await pending
        .locator('.ui-icon-loading')
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
    );
    await save.waitFor();
    assert.equal(
      await page
        .locator('#patterns .ui-disclosure-indicator')
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      '0s',
    );
  }
}
