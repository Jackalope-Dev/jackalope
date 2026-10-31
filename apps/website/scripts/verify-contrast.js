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
        // Gradient-clipped text has no single colour to measure, including spans inside it.
        let clipped = false;
        for (let node = el; node && !clipped; node = node.parentElement)
          clipped = getComputedStyle(node).backgroundClip === 'text';
        if (clipped) continue;
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
  for (const [palette, id] of [
    ['Mojave Sunset', 'mojave-sunset'],
    ['Alpine Aurora', 'alpine-aurora'],
    ['Electric Indigo', 'electric-indigo'],
    ['Zen Rose', 'zen-rose'],
  ]) {
    for (const appearance of ['Light', 'Dark']) {
      await page.evaluate(
        (saved) => localStorage.setItem('jackalope-website-theme', JSON.stringify(saved)),
        { id, isDark: appearance === 'Dark' },
      );
      await page.reload();
      await page.evaluate(() =>
        document.querySelectorAll('details').forEach((el) => {
          el.open = true;
        }),
      );
      const checks = [];
      const record = async (state) => checks.push({ state, ...(await audit()) });
      await record('default');
      await page.locator('.lp-download').hover();
      await record('download hover');
      const terminal = page.getByRole('textbox', { name: 'Message the demo agent' });
      await terminal.fill('/');
      await record('terminal command menu');
      await terminal.fill('');
      await page.locator('.landing-header .appearance-toggle').hover();
      await record('appearance hover');
      await page.locator('.landing-header .button').hover();
      await record('header action hover');
      await page.locator('.lp-final .button').hover();
      await record('final signup hover');
      // Builds without configured downloads offer signup in a dialog from the header.
      const signup = page
        .locator('.landing-header')
        .getByRole('button', { name: 'Sign up', exact: true });
      if (await signup.count()) {
        await signup.click();
        await page.getByRole('dialog').waitFor();
        await record('signup dialog');
        await page.keyboard.press('Escape');
      }
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
