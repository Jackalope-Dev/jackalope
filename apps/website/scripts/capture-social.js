async function _captureSocial(page) {
  await page.goto(await page.evaluate(() => location.origin));
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: 'apps/website/public/social-preview.png',
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
}
