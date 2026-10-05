async function _captureTour(page) {
  const light = await page.evaluate(() => document.documentElement.style.colorScheme === 'light');
  const imagePath = (name) => `apps/website/public/media/${name}${light ? '-light' : ''}.png`;
  // Notification previews are transient; keep them out of the stills.
  const quiet = async () => {
    // Development servers label the title bar; published stills show the product name.
    await page.evaluate(() => {
      for (const label of document.querySelectorAll('.app-titlebar-label span'))
        label.textContent = 'Jackalope';
    });
    const dismiss = page.getByRole('button', { name: 'Dismiss notification preview' });
    if (await dismiss.isVisible()) await dismiss.click();
  };
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: 'All work', exact: true }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.waitForTimeout(1500);
  await quiet();
  await page.screenshot({ path: imagePath('tasks') });
  await page.getByText('Improve the search experience').first().click();
  await page.getByRole('tab', { name: 'Review', exact: true }).click();
  await page.waitForTimeout(2000);
  await quiet();
  await page.screenshot({ path: imagePath('review') });
  await page.getByRole('button', { name: 'Agents & tools', exact: true }).click();
  await page.waitForTimeout(2000);
  await quiet();
  await page.screenshot({ path: imagePath('agents') });
}
