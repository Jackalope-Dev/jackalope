async function _captureTour(page) {
  const light = await page.evaluate(() => document.documentElement.style.colorScheme === 'light');
  const imagePath = (name) => `apps/website/public/media/${name}${light ? '-light' : ''}.png`;
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'tasks views', exact: true })
    .getByRole('button', { name: 'Inbox', exact: true })
    .click();
  const allTasks = page.getByRole('button', { name: 'All tasks', exact: true });
  if (await allTasks.isVisible()) await allTasks.click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.screenshot({ path: imagePath('tasks') });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /^Improve the search experience/ }).click();
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByText('Read patch', { exact: true }).click();
  await page
    .getByText('Read patch', { exact: true })
    .evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: imagePath('review') });
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('heading', { name: 'Your agents' }).waitFor();
  await page.screenshot({ path: imagePath('agents') });
  await page.waitForTimeout(3000);
}
