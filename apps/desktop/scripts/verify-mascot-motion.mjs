import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const output = 'output/playwright/mascot-motion';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  const base = process.argv[2] ?? 'http://localhost:5173';
  await page.goto(`${base}/design-lab.html`);
  const mascot = page.locator('button[data-mood]').first();
  await mascot.waitFor();
  await page.mouse.move(1200, 750);
  const gaze = () =>
    mascot.locator('[data-mascot-gaze]').evaluate((node) => {
      const matrix = new DOMMatrix(getComputedStyle(node).transform);
      return { x: matrix.e, y: matrix.f, angle: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI };
    });
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-mascot-gaze]');
    return new DOMMatrix(getComputedStyle(node).transform).e > 0.5;
  });
  const moved = await gaze();
  assert.ok(moved.x <= 1.21 && Math.abs(moved.y) <= 0.81 && Math.abs(moved.angle) <= 2.41);
  const blinks = await mascot.locator('ellipse').evaluate(
    (eye) =>
      new Promise((resolve) => {
        let count = 0;
        let closed = false;
        const start = performance.now();
        const sample = () => {
          const nowClosed = new DOMMatrix(getComputedStyle(eye).transform).d < 0.4;
          if (nowClosed && !closed) count++;
          closed = nowClosed;
          if (performance.now() - start > 7100) resolve(count);
          else requestAnimationFrame(sample);
        };
        sample();
      }),
  );
  assert.ok(blinks >= 2 && blinks <= 3, `Expected occasional repeated blinks, got ${blinks}`);
  await page.screenshot({ path: `${output}/idle-gaze.png` });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerout')));
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-mascot-gaze]');
    return Math.abs(new DOMMatrix(getComputedStyle(node).transform).e) < 0.01;
  });
  for (const mood of ['thinking', 'working', 'success', 'sleep']) {
    await page.getByRole('button', { name: mood, exact: true }).click();
    await page.mouse.move(1190, 740);
    assert.equal(await mascot.getAttribute('data-mood'), mood);
    assert.deepEqual(await gaze(), { x: 0, y: 0, angle: 0 });
  }
  await page.getByRole('button', { name: 'idle', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Reduce motion', exact: true }).check();
  await page.mouse.move(1200, 750);
  assert.deepEqual(await gaze(), { x: 0, y: 0, angle: 0 });
  await page.goto(base);
  await page.getByRole('heading', { name: 'Choose your theme', exact: true }).waitFor();
  await page.evaluate(() => {
    window.nodFrames = [];
    const sample = () => {
      const mascot = document.querySelector('button[data-mood]');
      const head = mascot.querySelector('[data-mascot-gaze]').parentElement;
      const matrix = new DOMMatrix(getComputedStyle(head).transform);
      window.nodFrames.push({
        step: document.querySelector('#onboarding-heading')?.dataset.step,
        nodding: mascot.hasAttribute('data-nodding'),
        angle: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
      });
      if (document.querySelector('#onboarding-heading')?.dataset.step === 'theme')
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Keep theme and continue', exact: true }).click();
  assert.ok(await page.getByRole('button', { name: 'Saving…', exact: true }).isDisabled());
  await page.getByRole('heading', { name: 'Choose a project', exact: true }).waitFor();
  const frames = await page.evaluate(() => window.nodFrames);
  assert.ok(frames.some((frame) => frame.nodding && frame.step === 'theme' && frame.angle > 5));
  assert.ok(!frames.some((frame) => frame.nodding && frame.step !== 'theme'));
  assert.ok(
    await page
      .getByRole('heading', { name: 'Choose a project', exact: true })
      .evaluate((node) => node === document.activeElement),
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Keep theme and continue', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Choose a project', exact: true })
    .waitFor({ timeout: 250 });
  assert.equal(await page.locator('[data-nodding]').count(), 0);
  const verify = new Function(
    `${await readFile('apps/desktop/scripts/verify-onboarding.js', 'utf8')}\nreturn _verifyOnboarding;`,
  )();
  console.log(await verify(page));
  assert.deepEqual(errors, []);
  console.log(
    'Idle blinks, bounded gaze, activity moods, nod-before-advance and reduced motion passed.',
  );
} finally {
  await browser.close();
}
