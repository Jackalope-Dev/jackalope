async function _verifyOnboarding(page) {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(page.url());
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('heading', { name: 'Set up Jackalope', exact: true }).waitFor();
  assert(
    (await page
      .getByRole('button', { name: /Skip setup|Capture an idea first|Finish without a task/ })
      .count()) === 0,
    'Onboarding has no bypass actions',
  );
  assert((await page.locator('.onboarding-privacy-panel').count()) === 0, 'Theme hides privacy');
  await page.getByRole('heading', { name: 'Choose your theme', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  await page.getByRole('button', { name: 'Reset preview', exact: true }).click();
  assert(
    await page.evaluate(
      () => document.documentElement.style.getPropertyValue('--accent-h') === '245',
    ),
    'Inline theme preview resets',
  );
  await page.getByRole('button', { name: 'Keep theme and continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Choose a project', exact: true }).waitFor();
  assert(
    (await page.locator('.onboarding-privacy-panel').getAttribute('open')) === null,
    'Project privacy is collapsed by default',
  );
  await page.getByRole('button', { name: 'Personalize your workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel theme preview', exact: true }).click();
  assert(
    await page.evaluate(
      () => document.documentElement.style.getPropertyValue('--accent-h') === '245',
    ),
    'Theme preview rolls back',
  );
  await page.getByRole('button', { name: 'Personalize your workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Mojave Sunset', exact: true }).click();
  await page.getByRole('button', { name: 'Keep theme', exact: true }).click();
  await page.reload();
  assert(
    await page.evaluate(
      () => document.documentElement.style.getPropertyValue('--accent-h') === '24',
    ),
    'Saved theme survives reload',
  );
  await page.evaluate(async () => {
    const module = (name) =>
      import(
        performance
          .getEntriesByType('resource')
          .find((r) => r.name.includes(`/src/stores/${name}.ts`)).name
      );
    const { useExecutionStore: execution } = await module('executionStore');
    const { useContextMemoryStore: memory } = await module('contextMemoryStore');
    const { useCommunityStore: community } = await module('communityStore');
    window.onboardingFixture = { calls: [], collision: true, selectedFolder: null };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 0,
      invoke: async (command, args) => {
        const fixture = window.onboardingFixture;
        fixture.calls.push({ command, args });
        if (command === 'agent_save_policy' && fixture.policyFailure)
          throw new Error('Agent settings could not be saved. Please retry.');
        if (command === 'mcp_list_servers' || command === 'knowledge_list') return [];
        if (command === 'schedule_list') return { schedules: [] };
        if (command === 'task_history_recovery') return { directory: 'fixture', entries: [] };
        if (command === 'task_project_directory') return 'C:/fixture/Projects';
        if (command === 'task_pick_project') return fixture.selectedFolder;
        if (command === 'task_create_project') {
          if (fixture.collision)
            throw new Error(
              'That folder already exists. Choose another name or open it as an existing project.',
            );
          return {
            path: `${args.parentPath ?? 'C:/fixture/Projects'}/${args.name}`,
            name: args.name,
            branch: 'main',
          };
        }
        if (command === 'task_validate_project')
          return { path: args.path, name: 'Existing project', branch: 'main' };
        if (command === 'app_community_settings' || command === 'app_community_configure') {
          return {
            reviewed: true,
            telemetry: false,
            errors: false,
            configured: false,
            buildChannel: 'stable',
          };
        }
        return null;
      },
    };
    memory.setState({ refreshMemory: async () => {} });
    community.setState({
      settings: {
        reviewed: true,
        telemetry: false,
        errors: false,
        configured: false,
        buildChannel: 'stable',
      },
    });
    execution.setState({
      refresh: async () => execution.setState({ error: null }),
      discover: async () =>
        execution.setState({
          runners: [
            {
              id: 'codex',
              name: 'Codex',
              available: true,
              signedIn: true,
              account: 'fixture',
              detail: 'Browser state only; no native tasks launched',
            },
            {
              id: 'claude',
              name: 'Claude',
              available: true,
              signedIn: true,
              detail: 'Browser state only; no native tasks launched',
            },
          ],
        }),
    });
  });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['Light', 'Dark']) {
      await page.getByRole('radio', { name: mode, exact: true }).focus();
      await page.keyboard.press('Space');
      assert(
        (await page.locator('.onboarding-privacy-panel').count()) === 0,
        'Theme hides privacy',
      );
      await page.screenshot({ path: `output/playwright/onboarding-theme-${mode}-${width}.png` });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Theme fits viewport',
      );
    }
  }
  await page.getByRole('button', { name: 'Keep theme and continue', exact: true }).click();
  await page.locator('.onboarding-privacy-panel summary').focus();
  await page.keyboard.press('Enter');
  assert(
    (await page
      .getByRole('switch', { name: 'Share anonymous usage counts', exact: true })
      .getAttribute('aria-checked')) === 'false',
    'Saved opt-out remains off',
  );
  await page.getByRole('switch', { name: 'Allow MCP marketplace', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(async () => {
    const module = (name) =>
      import(
        performance
          .getEntriesByType('resource')
          .find((resource) => resource.name.includes(`/src/stores/${name}.ts`)).name
      );
    const { useCommunityStore: community } = await module('communityStore');
    const { useSettingsStore: settings } = await module('settingsStore');
    community.setState({ settings: { ...community.getState().settings, reviewed: false } });
    settings.setState({ telemetryEnabled: false, crashReportingEnabled: false });
  });
  await page.getByRole('button', { name: 'Keep theme and continue', exact: true }).click();
  assert(
    await page.evaluate(
      () =>
        !window.onboardingFixture.calls.some((call) => call.command === 'app_community_configure'),
    ),
    'Theme continuation does not approve privacy',
  );
  await page.locator('.onboarding-privacy-panel summary').click();
  assert(
    (await page
      .getByRole('switch', { name: 'Allow MCP marketplace', exact: true })
      .getAttribute('aria-checked')) === 'false',
    'Marketplace opt-out survives navigation',
  );
  await page.getByRole('button', { name: 'Create new project', exact: true }).click();
  const create = page.getByRole('button', { name: 'Create project and continue', exact: true });
  assert(await create.isDisabled(), 'A project name is required');
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('My new project');
  await page.getByRole('button', { name: 'Change folder', exact: true }).click();
  await page.getByText('C:/fixture/Projects', { exact: true }).waitFor();
  await create.click();
  await page.getByRole('alert').filter({ hasText: 'That folder already exists' }).waitFor();
  assert(
    await page.evaluate(() => {
      const calls = window.onboardingFixture.calls.filter(
        (call) => call.command === 'app_community_configure',
      );
      return (
        calls.length === 1 && calls[0].args.telemetry === false && calls[0].args.errors === false
      );
    }),
    `Project continuation saves existing opt-outs: ${JSON.stringify(await page.evaluate(() => window.onboardingFixture.calls.filter((call) => call.command === 'app_community_configure')))}`,
  );
  assert(
    (await page.getByRole('textbox', { name: 'Project name', exact: true }).inputValue()) ===
      'My new project',
    'Creation failure preserves the name',
  );
  await page.evaluate(() => {
    window.onboardingFixture.selectedFolder = 'C:/fixture/Custom';
    window.onboardingFixture.collision = false;
  });
  await page.getByRole('button', { name: 'Change folder', exact: true }).click();
  await page.getByRole('button', { name: 'Open existing', exact: true }).click();
  await page.getByRole('button', { name: 'Create new project', exact: true }).click();
  assert(
    (await page.getByRole('textbox', { name: 'Project name', exact: true }).inputValue()) ===
      'My new project',
    'Changing project mode preserves the draft',
  );
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const isDark of [false, true]) {
      await page.evaluate(async (isDark) => {
        const { useThemeStore: theme } = await import(
          performance
            .getEntriesByType('resource')
            .find((r) => r.name.includes('/src/stores/themeStore.ts')).name
        );
        theme
          .getState()
          .setTheme({ ...theme.getState().currentTheme, appearance: 'manual', isDark });
      }, isDark);
      await page.waitForTimeout(200);
      await page.getByRole('textbox', { name: 'Project name', exact: true }).focus();
      await page.screenshot({
        path: `output/playwright/onboarding-new-project-${isDark ? 'dark' : 'light'}-${width}.png`,
      });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'No horizontal overflow',
      );
    }
  }
  await create.click();
  await page
    .getByRole('heading', { name: 'Choose a default agent for Jackalope', exact: true })
    .waitFor();
  assert(
    (await page.locator('.onboarding-advanced').count()) === 0,
    'Advanced controls stay out of setup',
  );
  await page.getByText('Settings → Agents', { exact: true }).waitFor();
  const rescan = page.getByRole('button', { name: 'Re-scan agents', exact: true });
  await rescan.focus();
  await page.keyboard.press('Enter');
  const installSummary = page.locator('.onboarding-install-catalog > summary');
  await installSummary.focus();
  await page.keyboard.press('Enter');
  for (const [width, height] of [
    [1280, 840],
    [960, 640],
    [600, 640],
  ]) {
    await page.setViewportSize({ width, height });
    for (const isDark of [false, true]) {
      await page.evaluate(async (isDark) => {
        const { useThemeStore: theme } = await import(
          performance
            .getEntriesByType('resource')
            .find((r) => r.name.includes('/src/stores/themeStore.ts')).name
        );
        theme
          .getState()
          .setTheme({ ...theme.getState().currentTheme, appearance: 'manual', isDark });
      }, isDark);
      await rescan.scrollIntoViewIfNeeded();
      const control = await rescan.boundingBox();
      const progress = await page.locator('.onboarding-progress').boundingBox();
      assert(
        control.x > progress.x + progress.width &&
          Math.abs(control.y + control.height / 2 - progress.y - progress.height / 2) < 2,
        'Re-scan sits at the top right beside progress',
      );
      await page.screenshot({
        path: `output/playwright/onboarding-agent-${isDark ? 'dark' : 'light'}-${width}.png`,
      });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Agent setup fits the viewport',
      );
      await page.locator('.onboarding-catalog-card').last().scrollIntoViewIfNeeded();
      assert(
        await page
          .locator('.onboarding-content')
          .evaluate((pane) =>
            [
              pane,
              ...pane.querySelectorAll(
                '.onboarding-catalog-grid, .onboarding-catalog-card, .onboarding-command-box',
              ),
            ].every((element) => element.scrollWidth <= element.clientWidth + 1),
          ),
        'Expanded install commands fit the pane without horizontal overflow',
      );
      await page.screenshot({
        path: `output/playwright/onboarding-install-${isDark ? 'dark' : 'light'}-${width}.png`,
      });
    }
  }
  await installSummary.click();
  assert((await page.locator('.onboarding-privacy-panel').count()) === 0, 'Agent hides privacy');
  assert(
    await page.evaluate(
      () =>
        window.onboardingFixture.calls.filter((call) => call.command === 'app_community_configure')
          .length === 1,
    ),
    'Retry does not repeat privacy approval',
  );
  assert(
    await page.evaluate(() => {
      const calls = window.onboardingFixture.calls.filter(
        (call) => call.command === 'task_create_project',
      );
      return (
        calls.length === 2 &&
        calls[0].args.parentPath === null &&
        calls[1].args.parentPath === 'C:/fixture/Custom'
      );
    }),
    'Default and custom project locations reach native creation',
  );
  await page
    .locator('.onboarding-runner')
    .filter({ has: page.getByText('Claude', { exact: true }) })
    .click();
  await page.evaluate(() => {
    window.onboardingFixture.policyFailure = true;
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Agent settings could not be saved' }).waitFor();
  assert(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('jackalope-agent-config-v1')).state.defaultMetaAgent ===
        'codex',
    ),
    'A failed policy save restores the previous default',
  );
  assert(
    (await page.locator('[data-nodding]').count()) === 0,
    'Failed steps do not nod or advance',
  );
  await page.evaluate(() => {
    window.onboardingFixture.policyFailure = false;
  });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Describe your first task', exact: true }).waitFor();
  assert(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('jackalope-agent-config-v1')).state.defaultMetaAgent ===
        'claude',
    ),
    'Choosing a default persists it beyond the first task',
  );
  assert(
    await page.evaluate(() =>
      window.onboardingFixture.calls.some(
        (call) =>
          call.command === 'agent_save_policy' && call.args.policy.defaultMetaAgent === 'claude',
      ),
    ),
    'The chosen default reaches native policy',
  );
  assert((await page.locator('.onboarding-privacy-panel').count()) === 0, 'Task hides privacy');
  const prompt = page.getByRole('textbox', { name: 'Your first task (optional)', exact: true });
  assert(
    (await prompt.inputValue()).includes('plan what to build'),
    'New project offers a first-task draft',
  );
  await prompt.fill('');
  assert(
    await page.getByRole('button', { name: 'Review first task', exact: true }).isDisabled(),
    'A first task is required',
  );
  await prompt.fill('Build the first milestone in this project.');
  await page.evaluate(() => {
    window.onboardingNativeFixture = window.__TAURI_INTERNALS__;
  });
  await page.getByRole('button', { name: 'Review first task', exact: true }).click();
  await page.getByRole('heading', { name: 'Opening your workspace', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to setup', exact: true }).click();
  await page.getByRole('heading', { name: 'Describe your first task', exact: true }).waitFor();
  await page.waitForTimeout(1800);
  assert(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jackalope-onboarding-v1')).state.status === 'active',
    ),
    'Returning from the transition leaves onboarding active',
  );
  await page.evaluate(async () => {
    const { useExecutionStore: execution } = await import(
      performance
        .getEntriesByType('resource')
        .find((r) => r.name.includes('/src/stores/executionStore.ts')).name
    );
    execution.setState({
      refresh: async () => execution.setState({ error: 'Simulated history read failure' }),
    });
  });
  await page.getByRole('button', { name: 'Review first task', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Workspace checks need attention', exact: true })
    .waitFor();
  await page.evaluate(async () => {
    const { useExecutionStore: execution } = await import(
      performance
        .getEntriesByType('resource')
        .find((r) => r.name.includes('/src/stores/executionStore.ts')).name
    );
    execution.setState({
      refresh: async () => execution.setState({ error: null }),
      discovering: true,
    });
  });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page
    .getByRole('button', { name: 'Open workspace', exact: true })
    .waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'What do you want to accomplish?', exact: true })
    .waitFor();
  assert(
    (await page.getByRole('dialog').locator('textarea').inputValue()) ===
      'Build the first milestone in this project.',
    'First-task draft reaches the workspace',
  );
  assert(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('jackalope-onboarding-v1')).state.status === 'complete',
    ),
    'Workspace entry completes onboarding',
  );
  await page.getByRole('button', { name: 'Close capture', exact: true }).click();
  await page.evaluate(async () => {
    const module = (name) =>
      import(
        performance
          .getEntriesByType('resource')
          .find((r) => r.name.includes(`/src/stores/${name}.ts`)).name
      );
    const { useOnboardingStore: onboarding } = await module('onboardingStore');
    const { useExecutionStore: execution } = await module('executionStore');
    execution.setState({ discovering: false });
    window.__TAURI_INTERNALS__ = window.onboardingNativeFixture;
    onboarding.getState().begin();
  });
  await page.getByRole('button', { name: 'Keep theme and continue', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Repository folder', exact: true })
    .fill('C:/fixture/Existing');
  await page.getByRole('button', { name: 'Continue with this project', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Choose a default agent for Jackalope', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your first task (optional)', exact: true })
    .fill('Review the existing project.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Review first task', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'What do you want to accomplish?', exact: true })
    .waitFor({ timeout: 1000 });
  assert(
    await page.evaluate(
      () => !window.onboardingFixture.calls.some((call) => call.command === 'task_start'),
    ),
    'Setup never starts a task',
  );
  assert(errors.length === 0, errors.join('\n'));
  return {
    requiredSetup: true,
    collapsedPrivacy: true,
    createProject: true,
    creationRecovery: true,
    existingProject: true,
    defaultAndCustomFolder: true,
    requiredFirstTask: true,
    firstTaskDraft: true,
    back: true,
    retry: true,
    slowRecovery: true,
    reducedMotion: true,
    themePersistence: true,
    themeRollback: true,
    errors,
    fixtures: 'Browser state only; no native tasks launched',
  };
}
