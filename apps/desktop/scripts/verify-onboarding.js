async function _verifyOnboarding(page) {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('heading', { name: 'Set up Jackalope', exact: true }).waitFor();
  assert(
    await page.evaluate(
      () => document.documentElement.style.getPropertyValue('--accent-h') === '245',
    ),
    'New profile uses Indigo',
  );
  await page.getByRole('button', { name: 'Personalize your workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel theme preview', exact: true }).click();
  assert(
    await page.evaluate(
      () => document.documentElement.style.getPropertyValue('--accent-h') === '245',
    ),
    'Cancel theme preview preserves Indigo',
  );
  await page.getByRole('button', { name: 'Personalize your workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  await page.getByRole('button', { name: 'Keep theme', exact: true }).click();
  await page.reload();
  assert(
    await page.evaluate(
      () => document.documentElement.style.getPropertyValue('--accent-h') === '24',
    ),
    'Saved theme survives new default',
  );
  await page.evaluate(async () => {
    const { useThemeStore } = await import('/src/stores/themeStore.ts');
    useThemeStore.getState().setTheme(useThemeStore.getInitialState().currentTheme);
  });
  await page.getByRole('button', { name: 'Skip setup for now', exact: true }).click();
  await page.getByRole('heading', { name: 'Opening your workspace', exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/desktop-transition.png' });
  assert(
    await page
      .locator('.brand-echo-line')
      .first()
      .evaluate((el) => getComputedStyle(el).animationPlayState === 'running'),
    'Transition loop',
  );
  await page.locator('#workspace-content').waitFor();
  assert(
    await page.locator('#workspace-content').evaluate((el) => el === document.activeElement),
    'Workspace receives focus',
  );
  const reopen = async () =>
    page.evaluate(async () => {
      const { useOnboardingStore } = await import('/src/stores/onboardingStore.ts');
      useOnboardingStore.getState().begin();
    });
  await reopen();
  await page.getByRole('button', { name: 'Skip setup for now', exact: true }).click();
  await page.getByRole('button', { name: 'Back to setup', exact: true }).click();
  await page.getByRole('heading', { name: 'Set up Jackalope', exact: true }).waitFor();
  await page.waitForTimeout(1800);
  assert(
    await page.getByRole('heading', { name: 'Set up Jackalope', exact: true }).isVisible(),
    'Back cancels pending completion',
  );
  await page.getByRole('button', { name: 'Capture an idea first', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'What do you want to accomplish?', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Close capture', exact: true }).click();
  await reopen();
  await page.evaluate(async () => {
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    window.restoreRefresh = useExecutionStore.getState().refresh;
    useExecutionStore.setState({
      refresh: async () => {
        useExecutionStore.setState({ error: 'Simulated history read failure' });
      },
    });
  });
  await page.getByRole('button', { name: 'Skip setup for now', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Workspace checks need attention', exact: true })
    .waitFor();
  await page.evaluate(async () => {
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    useExecutionStore.setState({ refresh: window.restoreRefresh });
  });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.locator('#workspace-content').waitFor();
  await reopen();
  await page.evaluate(async () => {
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    useExecutionStore.setState({ discovering: true });
  });
  await page.getByRole('button', { name: 'Skip setup for now', exact: true }).click();
  await page.setViewportSize({ width: 960, height: 640 });
  await page.screenshot({ path: 'output/playwright/desktop-transition-960.png' });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Transition fits 960 width',
  );
  await page
    .getByRole('button', { name: 'Open workspace', exact: true })
    .waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.locator('#workspace-content').waitFor();
  await page.evaluate(async () => {
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    useExecutionStore.setState({ discovering: false });
  });
  await reopen();
  await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/projectStore.ts');
    const { useExecutionStore } = await import('/src/stores/executionStore.ts');
    const { useOnboardingStore } = await import('/src/stores/onboardingStore.ts');
    useProjectStore.setState({
      projects: [
        {
          id: 'onboarding-fixture',
          name: 'Onboarding fixture',
          path: 'C:/fixture',
          gitBranch: 'main',
          worktrees: [],
          agentProvider: 'codex',
        },
      ],
      activeProjectId: 'onboarding-fixture',
    });
    useExecutionStore.setState({
      runners: [
        {
          id: 'codex',
          name: 'Codex',
          available: true,
          signedIn: true,
          account: 'fixture',
          detail: 'UI fixture only',
        },
      ],
    });
    useExecutionStore.getState().draft('onboarding-fixture', {
      agent: 'codex',
      prompt: 'Review this fixture without executing any task.',
    });
    useOnboardingStore.getState().go('task');
  });
  await page.getByRole('button', { name: 'Review first task', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'What do you want to accomplish?', exact: true })
    .waitFor();
  assert(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jackalope-onboarding-v1')).state.status === 'complete',
    ),
    'Finishing first task completes onboarding',
  );
  assert(
    (await page.getByRole('dialog').locator('textarea').inputValue()) ===
      'Review this fixture without executing any task.',
    'First-task draft retained',
  );
  assert(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('jackalope-execution-ui-v1')).state.drafts.capture
          .prompt === '',
    ),
    'Earlier capture draft preserved',
  );
  await page.getByRole('button', { name: 'Close capture', exact: true }).click();
  await reopen();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.getByRole('button', { name: 'Skip setup for now', exact: true }).click();
  await page.locator('#workspace-content').waitFor({ timeout: 1000 });
  assert(errors.length === 0, errors.join('\n'));
  return {
    defaultTheme: true,
    savedTheme: true,
    previewRollback: true,
    skip: true,
    capture: true,
    back: true,
    retry: true,
    slowRecovery: true,
    firstTaskDraft: true,
    reducedMotion: true,
    fixtures: 'Browser state only; no native tasks launched',
    errors,
  };
}
