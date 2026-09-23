async function _verifyContrast(page) {
  await page.goto('http://127.0.0.1:5182/');
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const audit = async () =>
    page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = (value) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].map((x, i) => (i === 3 ? x / 255 : x));
      };
      const over = (top, bottom) =>
        [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
      const lum = (rgb) =>
        rgb
          .slice(0, 3)
          .map((c) => c / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
      const contrast = (a, b) =>
        (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      const failures = [];
      let total = 0;
      let min = 100;
      for (const el of document.querySelectorAll('header *, main *, footer *, [role=dialog] *')) {
        if (
          !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
          !el.getClientRects().length
        )
          continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const style = getComputedStyle(el);
        const ancestors = [];
        let node = el;
        while (node) {
          ancestors.unshift(node);
          node = node.parentElement;
        }
        let bg = [255, 255, 255, 1];
        for (const node of ancestors) bg = over(rgba(getComputedStyle(node).backgroundColor), bg);
        const ratio = contrast(over(rgba(style.color), bg), bg);
        const large =
          parseFloat(style.fontSize) >= 24 ||
          (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
        const required = large ? 3 : 4.5;
        total++;
        min = Math.min(min, ratio);
        if (ratio + 0.02 < required)
          failures.push({
            text: el.textContent.trim().slice(0, 65),
            tag: el.tagName,
            cls: typeof el.className === 'string' ? el.className : 'svg',
            ratio: +ratio.toFixed(2),
            required,
            color: style.color,
            bg,
          });
      }
      return { total, min: +min.toFixed(2), failures };
    });
  const results = [];
  for (const palette of ['Mojave Sunset', 'Alpine Aurora', 'Electric Indigo', 'Zen Rose']) {
    await page.getByRole('button', { name: palette, exact: true }).click();
    for (const appearance of ['Light', 'Dark']) {
      await page.getByRole('button', { name: appearance, exact: true }).click();
      await page.evaluate(() =>
        document.querySelectorAll('details').forEach((el) => {
          el.open = true;
        }),
      );
      const checks = [];
      const record = async (state) => checks.push({ state, ...(await audit()) });
      await record('default');
      for (const name of ['Changes & review', 'Agents & accounts']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await record(name);
      }
      for (const name of ['Find a stubborn bug', 'Explore a new direction']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await record(name);
      }
      await page.locator('.landing-header .appearance-toggle').hover();
      await record('appearance hover');
      await page.locator('.landing-header .button').hover();
      await record('signup hover');
      await page.locator('.landing-finale .button').hover();
      await record('footer signup hover');
      await page.getByRole('button', { name: 'Join waitlist', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await record('signup dialog');
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Tasks & ideas', exact: true }).click();
      await page.getByRole('tab', { name: 'Build a feature', exact: true }).click();
      const failures = checks.flatMap((check) =>
        check.failures.map((failure) => ({ state: check.state, ...failure })),
      );
      const result = {
        states: checks.length,
        min: Math.min(...checks.map((check) => check.min)),
        failures,
      };

      results.push({ palette, appearance, ...result });
    }
  }
  const failures = results.filter((result) => result.failures.length);
  if (failures.length) throw new Error(JSON.stringify(failures));
  return results;
}
