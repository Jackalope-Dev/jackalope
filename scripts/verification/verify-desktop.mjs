import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const size of [
  { width: 1280, height: 840 },
  { width: 960, height: 640 },
]) {
  const context = await browser.newContext({ viewport: size, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5177');
  await page.evaluate(async () => {
    const { useOnboardingStore } = await import('/src/stores/onboardingStore.ts');
    const { useProjectStore } = await import('/src/stores/projectStore.ts');
    const { useTaskStore } = await import('/src/stores/taskStore.ts');
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    useOnboardingStore.getState().finish();
    useProjectStore.setState({
      projects: [
        {
          id: 'atlas',
          name: 'Atlas sample project',
          path: 'C:/Projects/atlas',
          gitBranch: 'main',
          worktrees: [],
          agentProvider: 'codex',
        },
      ],
      activeProjectId: 'atlas',
    });
    useTaskStore.setState({
      tasks: [
        {
          id: 'sample',
          projectId: 'atlas',
          title: 'Explore keyboard search',
          rawPrompt: 'Sample idea only',
          status: 'backlog',
          createdAt: '2026-09-08T15:00:00Z',
          updatedAt: '2026-09-08T15:00:00Z',
        },
      ],
    });
    useExecutionStore.setState({
      runs: [],
      runners: [],
      loading: false,
      error: null,
      refresh: async () => {},
      discover: async () => {},
    });
  });
  const priorities = page.getByRole('group', { name: 'Focus your work' });
  const saved = priorities.getByRole('button', { name: '1 Saved ideas' });
  await saved.focus();
  await page.keyboard.press('Space');
  assert.equal(await saved.getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Space');
  assert.equal(await saved.getAttribute('aria-pressed'), 'false');
  const invite = page.getByRole('button', { name: 'Invitations', exact: true });
  await invite.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Invitations', exact: true })
      .getAttribute('aria-current'),
    'page',
  );
  await page.screenshot({ path: `output/growth-redesign/desktop-invitations-${size.width}.png` });
  await page.keyboard.press('Escape');
  assert(
    await invite.evaluate((element) => element === document.activeElement),
    'Invitation focus did not return',
  );
  const picker = page.getByRole('button', { name: 'Personalize your workspace' });
  const color = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg'));
  const original = await color();
  await picker.click();
  await page.getByRole('radio', { name: 'Light', exact: true }).focus();
  await page.keyboard.press('Space');
  assert.notEqual(await color(), original);
  await page.keyboard.press('Escape');
  assert.equal(await color(), original, 'Preview rollback failed');
  for (const appearance of ['Light', 'Dark']) {
    await picker.click();
    await page.getByRole('radio', { name: appearance, exact: true }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Keep theme', exact: true }).click();
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Desktop overflow',
    );
    await page.screenshot({
      path: `output/growth-redesign/desktop-${size.width}-${appearance.toLowerCase()}.png`,
    });
  }
  const savedColor = await color();
  await page.reload();
  await page.getByRole('button', { name: 'Personalize your workspace' }).waitFor();
  assert.equal(await color(), savedColor, 'Saved appearance did not persist');
  assert.deepEqual(errors, []);
  await context.close();
}
await browser.close();
console.log(
  'Desktop fixture checks passed: priority keyboard toggles, Invitations entry/focus return, theme preview rollback and persistence, both sizes and appearances, reduced motion.',
);
