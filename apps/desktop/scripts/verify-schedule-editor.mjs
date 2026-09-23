import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('output/playwright', { recursive: true });
  await page.goto(process.env.JACKALOPE_TEST_URL ?? 'http://localhost:5173');
  await page.evaluate(async () => {
    const module = (name) =>
      import(
        performance
          .getEntriesByType('resource')
          .find((r) => r.name.includes(`/src/stores/${name}.ts`)).name
      );
    const { useProjectStore } = await module('projectStore');
    const { useOnboardingStore } = await module('onboardingStore');
    await useProjectStore.getState().addProject({
      id: 'schedule-fixture',
      name: 'Schedule fixture',
      path: 'C:/fixture/project',
      gitBranch: 'master',
      agentProvider: 'codex',
    });
    window.scheduleFixture = { saved: [], calls: [], loading: true, resolvers: [] };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 0,
      invoke: async (command, args) => {
        window.scheduleFixture.calls.push(command);
        if (command === 'app_execution_access')
          return { required: true, allowed: false, validUntil: null };
        if (command === 'helper_snapshot')
          return { turns: [], actions: [], connected: false, error: null };
        if (command === 'schedule_list' && window.scheduleFixture.loading)
          return new Promise((resolve) => window.scheduleFixture.resolvers.push(resolve));
        if (command === 'schedule_list')
          return {
            schedules: window.scheduleFixture.saved.map((definition) => ({
              definition,
              nextAt: '2026-09-10T09:00:00Z',
              history: [],
            })),
            error: null,
          };
        if (command === 'schedule_save') {
          window.scheduleFixture.saved = [structuredClone(args.definition)];
          return;
        }
        if (['task_runs', 'task_runners', 'knowledge_list', 'mcp_list_servers'].includes(command))
          return [];
        if (command === 'knowledge_preview') return { entries: [], bytes: 0 };
        if (command === 'task_history_recovery') return { directory: 'fixture', entries: [] };
        return null;
      },
    };
    useOnboardingStore.getState().finish();
  });
  await page.getByRole('button', { name: 'Open saved work', exact: true }).click();
  await page.getByRole('button', { name: 'Recurring', exact: true }).click();
  const loading = page.locator('.workspace-loading').filter({ hasText: 'Loading schedules…' });
  await loading.waitFor();
  assert.equal(await loading.locator('.workspace-loading-row').count(), 3);
  assert.notEqual(
    await loading.locator('svg').evaluate((element) => getComputedStyle(element).animationName),
    'none',
  );
  await page.screenshot({ path: 'output/playwright/schedule-loading.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await loading.locator('svg').evaluate((element) => getComputedStyle(element).animationName),
    'none',
  );
  assert.equal(
    await loading
      .locator('.workspace-loading-skeleton')
      .evaluate((element) => getComputedStyle(element).animationName),
    'none',
  );
  await page.evaluate(() => {
    window.scheduleFixture.loading = false;
    for (const resolve of window.scheduleFixture.resolvers) resolve({ schedules: [], error: null });
  });
  await loading.waitFor({ state: 'hidden' });
  const search = page.getByRole('textbox', { name: 'Search recurring templates', exact: true });
  await search.waitFor();
  assert.ok(
    await search.evaluate((input) => {
      const icon = input.parentElement.querySelector('svg').getBoundingClientRect();
      const box = input.getBoundingClientRect();
      return (
        icon.left > box.left &&
        icon.right < box.right &&
        icon.top > box.top &&
        icon.bottom < box.bottom
      );
    }),
  );
  await page.getByRole('button', { name: 'New schedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule recurring work', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.locator('details').count(), 0);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Morning review');
  await page
    .getByRole('textbox', { name: 'Instructions', exact: true })
    .fill('Review recent changes and report findings. Do not modify files.');
  await page.locator('#schedule-time').fill('10:30');
  await page.getByRole('textbox', { name: 'Timezone', exact: true }).fill('America/Denver');
  await page.getByRole('combobox', { name: 'Repeat schedule', exact: true }).click();
  await page.getByRole('option', { name: 'Every week', exact: true }).click();
  await page.getByRole('combobox', { name: 'Day of week', exact: true }).click();
  await page.getByRole('option', { name: 'Friday', exact: true }).click();
  for (const width of [1280, 960, 700]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const isDark of [false, true]) {
      await page.evaluate(async (isDark) => {
        const { useThemeStore } = await import(
          performance
            .getEntriesByType('resource')
            .find((r) => r.name.includes('/src/stores/themeStore.ts')).name
        );
        useThemeStore
          .getState()
          .setTheme({ ...useThemeStore.getState().currentTheme, appearance: 'manual', isDark });
      }, isDark);
      await page.waitForTimeout(250);
      await page.screenshot({
        path: `output/playwright/schedule-editor-${isDark ? 'dark' : 'light'}-${width}.png`,
      });
      assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth));
      const save = await page
        .getByRole('button', { name: 'Save schedule', exact: true })
        .boundingBox();
      assert.ok(save.y >= 0 && save.y + save.height <= (width === 1280 ? 840 : 640));
    }
  }
  await page.getByLabel('Use matching project lessons (up to three)', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(
    await page.evaluate(() => {
      const schedule = window.scheduleFixture.saved[0];
      return {
        expression: schedule.expression,
        timezone: schedule.timezone,
        enabled: schedule.enabled,
        agent: schedule.request.agent,
        prompt: schedule.rawPrompt,
      };
    }),
    {
      expression: '30 10 * * 5',
      timezone: 'America/Denver',
      enabled: false,
      agent: 'auto',
      prompt: 'Review recent changes and report findings. Do not modify files.',
    },
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('combobox', { name: 'Repeat schedule', exact: true }).click();
  await page.getByRole('option', { name: 'Every few hours', exact: true }).click();
  await page.getByRole('combobox', { name: 'Hourly interval', exact: true }).click();
  await page.getByRole('option', { name: 'Every 4 hours', exact: true }).click();
  await page.locator('#schedule-minute').fill('17');
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => window.scheduleFixture.saved[0].expression),
    '17 */4 * * *',
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.locator('#schedule-minute').inputValue(), '17');
  assert.match(
    await page.getByRole('combobox', { name: 'Hourly interval', exact: true }).innerText(),
    /Every 4 hours/,
  );
  assert.match(await dialog.innerText(), /Runs every 4 hours from 00:17/);
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const isDark of [false, true]) {
      await page.evaluate(async (isDark) => {
        const { useThemeStore } = await import(
          performance
            .getEntriesByType('resource')
            .find((r) => r.name.includes('/src/stores/themeStore.ts')).name
        );
        useThemeStore
          .getState()
          .setTheme({ ...useThemeStore.getState().currentTheme, appearance: 'manual', isDark });
      }, isDark);
      assert.ok(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth));
      await page.screenshot({
        path: `output/playwright/hourly-${width}-${isDark ? 'dark' : 'light'}.png`,
      });
    }
  }
  await page.getByRole('combobox', { name: 'Hourly interval', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.equal(
    await page
      .getByRole('combobox', { name: 'Hourly interval', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.getByRole('combobox', { name: 'Repeat schedule', exact: true }).click();
  await page.getByRole('option', { name: 'Custom cron', exact: true }).click();
  await page.getByRole('textbox', { name: 'Cron expression', exact: true }).fill('*/15 * * * *');
  await page
    .getByRole('radio', { name: 'Notify about changes without an agent', exact: true })
    .check();
  await page.locator('#schedule-watch-path').fill('src');
  await page.getByRole('combobox', { name: 'Missed runs', exact: true }).click();
  await page.getByRole('option', { name: 'Catch up once when available', exact: true }).click();
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(
    await page.evaluate(() => {
      const schedule = window.scheduleFixture.saved[0];
      return {
        expression: schedule.expression,
        missed: schedule.missed,
        monitor: schedule.monitor,
        memoryOff: schedule.request.contextSelection.memoryOff,
      };
    }),
    {
      expression: '*/15 * * * *',
      missed: 'once',
      monitor: { path: 'src', action: 'notify' },
      memoryOff: true,
    },
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(
    await page.getByRole('textbox', { name: 'Cron expression', exact: true }).inputValue(),
    '*/15 * * * *',
  );
  await page.keyboard.press('Escape');
  const template = page.getByRole('button', { name: /^Use template:/ }).first();
  await template.click();
  await page.locator('#schedule-instructions').waitFor();
  await page.locator('#schedule-template-context').waitFor();
  assert.equal(await page.getByRole('dialog').locator('details').count(), 0);
  await page.keyboard.press('Escape');
  assert.ok(await template.evaluate((button) => button === document.activeElement));
  assert.equal(
    await page.evaluate(() => window.scheduleFixture.calls.includes('task_start')),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Schedule search, visible settings, timing, paused save and responsive layout passed (browser fixture).',
  );
} finally {
  await browser.close();
}
