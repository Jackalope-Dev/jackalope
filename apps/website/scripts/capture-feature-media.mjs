import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const origin = process.env.JACKALOPE_CAPTURE_ORIGIN ?? 'http://localhost:5193';
const setup = new Function(
  `${readFileSync(new URL('./capture-setup.js', import.meta.url), 'utf8')}; return _captureSetup;`,
)();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const colorScheme of ['dark', 'light']) {
    const page = await browser.newPage({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(origin);
    await setup(page);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.addInitScript(() => {
      localStorage.setItem(
        'jackalope-schedules',
        JSON.stringify({ state: { schedules: [] }, version: 3 }),
      );
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'schedule_list') {
          return {
            error: null,
            schedules: [
              {
                name: 'Weekly dependency review',
                expression: '0 9 * * 1',
                prompt:
                  'Review outdated dependencies and recommend checks. Keep version changes a separate decision.',
                monitor: null,
              },
              {
                name: 'Watch API documentation',
                expression: '0 */6 * * *',
                prompt: 'Review documentation when the API changes.',
                monitor: { path: 'src/api', action: 'notify' },
              },
            ].map((item, index) => ({
              definition: {
                id: `sample-schedule-${index}`,
                ...item,
                enabled: false,
                timezone: 'America/Denver',
                missed: 'skip',
                request: {
                  id: `sample-task-${index}`,
                  projectId: 'alpha',
                  projectName: 'Atlas',
                  projectPath: 'C:/Fixture/Atlas',
                  agent: 'codex',
                  prompt: item.prompt,
                  isolated: true,
                  targetBranch: 'main',
                },
              },
              nextAt: '2026-09-14T15:00:00Z',
              history: [],
            })),
          };
        }
        return invoke(command, args);
      };
    });
    await page.reload();
    await page.getByRole('button', { name: 'Recurring', exact: true }).click();
    await page.getByRole('heading', { name: 'Weekly dependency review', exact: true }).waitFor();
    await page.evaluate(async (isDark) => {
      const { useThemeStore } = await import('/src/stores/themeStore.ts');
      const { useCompanionStore } = await import('/src/stores/companionStore.ts');
      useThemeStore.getState().setTheme({ ...useThemeStore.getState().currentTheme, isDark });
      useCompanionStore.setState({ sources: {} });
    }, colorScheme === 'dark');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const panel = await page.locator('.task-page').boundingBox();
    const schedules = await page.locator('.schedule-list').boundingBox();
    const clip = {
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: schedules.y + schedules.height - panel.y + 20,
    };
    await page.screenshot({
      clip,
      path: fileURLToPath(
        new URL(
          `../public/media/recurring${colorScheme === 'light' ? '-light' : ''}.png`,
          import.meta.url,
        ),
      ),
    });
    console.log(`${colorScheme}: ${clip.width} x ${clip.height}`);
    await page.close();
  }
} finally {
  await browser.close();
}
