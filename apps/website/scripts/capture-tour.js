async function _captureTour(page) {
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  const allTasks = page.getByRole('button', { name: 'All tasks', exact: true });
  if (await allTasks.isVisible()) await allTasks.click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.screenshot({ path: 'apps/website/public/media/tasks.png' });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /^Improve the search experience/ }).click();
  await page.getByRole('button', { name: 'Inspect changes', exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByText('Read patch', { exact: true }).click();
  await page
    .getByText('Read patch', { exact: true })
    .evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'apps/website/public/media/review.png' });
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('heading', { name: 'Your agents' }).waitFor();
  await page.screenshot({ path: 'apps/website/public/media/agents.png' });
  await page.waitForTimeout(3000);
}
