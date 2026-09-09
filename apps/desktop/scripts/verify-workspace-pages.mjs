import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('output/playwright', { recursive: true });
  await page.route('https://github.com/**', (route) => route.abort());
  await page.goto('http://localhost:5173');
  await page.getByRole('heading', { name: 'Set up Jackalope', exact: true }).waitFor();
  await page.evaluate(async () => {
    window.storeModule = (name) =>
      import(
        performance
          .getEntriesByType('resource')
          .find((r) => r.name.includes(`/src/stores/${name}.ts`))?.name ?? `/src/stores/${name}.ts`
      );
    const { useProjectStore } = await window.storeModule('projectStore');
    await useProjectStore.getState().addProject({
      id: 'pages-fixture',
      name: 'Trail workspace',
      path: 'C:/fixture/trail',
      gitBranch: 'master',
      agentProvider: 'codex',
    });
    window.pagesFixture = {
      calls: [],
      document:
        '# Trail workspace\n\n## Interface\n- [ ] Improve the search experience\n- [ ] Polish onboarding\n- [x] Add keyboard navigation\n',
      saved: [],
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 0,
      invoke: async (command, args) => {
        window.pagesFixture.calls.push(command);
        if (command === 'app_account_referrals')
          return {
            remaining: 3,
            limit: 5,
            accepted: 2,
            downloaded: 1,
            connected: 1,
            shareUrl: 'https://example.com/pass',
            invites: [],
          };
        if (command === 'agent_models')
          return {
            models: [
              { id: 'code-model', name: 'Code model', isDefault: true },
              { id: 'reason-model', name: 'Reasoning model', isDefault: false },
            ],
            detail: 'Models reported by the current CLI account.',
            source: 'fixture',
          };
        if (command === 'agent_profile_list')
          return {
            profiles: [{ id: 'fixture-account', name: 'Work account', group: 'work' }],
            activeId: null,
            envVar: 'FIXTURE_HOME',
          };
        if (command === 'codebase_scan')
          return {
            root: 'C:/fixture/trail',
            scannedAt: new Date().toISOString(),
            durationMs: 100,
            files: [
              {
                path: 'src/main.ts',
                language: 'TypeScript',
                lines: 42,
                bytes: 400,
                analyzed: true,
              },
            ],
            references: [],
            cycles: [],
            diagnostics: [],
            truncated: false,
          };
        if (command === 'mcp_save_server') {
          window.pagesFixture.mcpSaved = args.server;
          return;
        }
        if (command === 'agent_save_policy') {
          window.pagesFixture.policy = args.policy;
          return;
        }
        if (command === 'schedule_list') return { schedules: [], error: null };
        if (command === 'capacity_snapshot')
          return [
            {
              agent: 'codex',
              status: 'reported',
              account: 'Fixture account',
              source: 'fixture',
              observedAt: new Date().toISOString(),
              detail: '',
              windows: [
                {
                  poolId: 'fixture',
                  poolName: 'Plan',
                  window: 'primary',
                  usedPercent: 20,
                  remainingPercent: 80,
                  durationMinutes: 300,
                  resetsAt: Math.floor(Date.now() / 1000) + 3600,
                },
              ],
            },
          ];
        if (command === 'repo_todos_read')
          return [{ path: 'TODO.md', content: window.pagesFixture.document, error: null }];
        if (command === 'repo_todos_save') {
          window.pagesFixture.document = args.content;
          window.pagesFixture.saved.push(args);
          return;
        }
        if (command === 'knowledge_list')
          return [
            {
              id: 'lesson',
              projectId: 'pages-fixture',
              projectPath: 'C:/fixture/trail',
              kind: 'memory',
              title: 'Keep search keyboard friendly',
              content: 'Keep focus on the search input as results update. '.repeat(12),
              keywords: ['search'],
              enabled: true,
              sourceRunId: null,
              revision: 1,
              updatedAt: '2026-09-08T18:00:00Z',
            },
          ];
        if (['task_runs', 'mcp_list_servers'].includes(command)) return [];
        if (command === 'task_runners')
          return ['codex', 'claude', 'grok', 'antigravity'].map((id) => ({
            id,
            name: id === 'antigravity' ? 'Antigravity' : id[0].toUpperCase() + id.slice(1),
            available: id !== 'antigravity',
            desktopInstalled: id === 'antigravity',
            signedIn: false,
            account: '',
            detail: 'Desktop app found. Install agy to run tasks.',
          }));
        if (command === 'task_history_recovery') return { directory: 'fixture', entries: [] };
        if (command === 'knowledge_preview') return { entries: [], bytes: 0 };
        if (command === 'task_validate_project') return { gitBranch: 'master', isGit: true };
        return null;
      },
    };
    const { useContextMemoryStore } = await window.storeModule('contextMemoryStore');
    useContextMemoryStore.setState({
      memories: {
        'pages-fixture': {
          projectId: 'pages-fixture',
          projectName: 'Trail workspace',
          projectPath: 'C:/fixture/trail',
          summary: 'A thoughtful desktop workspace for building and reviewing projects.',
          techStack: ['React', 'TypeScript', 'Rust', 'Vite'],
          conventions: [
            'Keep keyboard focus visible across every control.',
            'Preserve existing project data and instructions.',
            'Use shared colors and components.',
            'Verify both appearances and narrow windows.',
          ],
          openTasks: [
            {
              id: 'todo-1',
              title: 'Improve the search experience',
              sourceFile: 'TODO.md',
              status: 'open',
            },
            { id: 'todo-2', title: 'Polish onboarding', sourceFile: 'TODO.md', status: 'open' },
          ],
          roadmapItems: [],
          buildCommands: ['pnpm build'],
          testCommands: ['pnpm test'],
          sourceFilesDetected: ['package.json', 'Cargo.toml', 'AGENTS.md', 'TODO.md'],
          lastScannedAt: '2026-09-08T18:00:00Z',
          scanDurationMs: 50,
          tokenUsageEstimate: 0,
        },
      },
    });
    const { useOnboardingStore } = await window.storeModule('onboardingStore');
    useOnboardingStore.getState().finish();
  });
  const navigate = async (tab) => {
    await page.evaluate(
      (tab) => window.dispatchEvent(new CustomEvent('jackalope:navigate', { detail: tab })),
      tab,
    );
  };
  await page.getByRole('heading', { name: 'Tasks', exact: true }).waitFor();
  await navigate('repo-todos');
  const row = page.locator('.repo-todo-group li').first();
  await row.waitFor();
  await row.locator('.repo-todo-title').click();
  await row.locator('.repo-todo-status').click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.locator('.repo-todo-group li').count(), 2);
  assert.equal(
    await page.getByRole('button', { name: 'Save changes', exact: true }).isDisabled(),
    true,
  );
  await row.hover();
  await row.getByRole('button', { name: 'Start task', exact: true }).click();
  const capture = page.getByRole('dialog', {
    name: 'What do you want to accomplish?',
    exact: true,
  });
  await capture.waitFor();
  assert.ok(
    await capture
      .locator('textarea')
      .first()
      .inputValue()
      .then(
        (value) =>
          value.includes('TODO.md, line 4') && value.includes('Improve the search experience'),
      ),
  );
  assert.equal(await page.evaluate(() => window.pagesFixture.calls.includes('task_start')), false);
  await page.getByRole('button', { name: 'Close capture' }).click();
  await row
    .getByRole('button', { name: 'Edit Improve the search experience', exact: true })
    .focus();
  assert.equal(
    await row
      .locator('.repo-todo-actions')
      .evaluate((element) => getComputedStyle(element).opacity),
    '1',
  );
  await page.keyboard.press('Enter');
  await page.getByLabel('Mark as completed').check();
  await page.getByRole('button', { name: 'Update TODO', exact: true }).click();
  assert.equal(await page.locator('.repo-todo-group li').count(), 1);
  assert.equal(await page.evaluate(() => window.pagesFixture.saved.length), 0);
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and reload', exact: true }).click();
  await page.locator('.repo-todo-group li').nth(1).waitFor();
  await page.getByRole('button', { name: 'Edit document', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit document', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Full document', exact: true })
    .fill('# Changed\n- [ ] Keep this safe\n');
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and reload', exact: true }).click();
  await page.locator('.repo-todo-group li').nth(1).waitFor();
  assert.equal(await page.evaluate(() => window.pagesFixture.saved.length), 0);
  await navigate('project-knowledge');
  await page.getByRole('heading', { name: 'Project context', exact: true }).waitFor();
  assert.equal(await page.locator('.context-instructions li').count(), 3);
  await page.getByRole('button', { name: 'View all 4 instructions', exact: true }).click();
  assert.equal(await page.locator('.context-instructions li').count(), 4);
  await page.getByRole('button', { name: 'Read full content' }).click();
  assert.equal(await page.locator('.context-knowledge-preview').count(), 0);
  await page.getByRole('button', { name: 'Show less', exact: true }).click();
  for (const width of [1280, 960, 700]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const isDark of [false, true]) {
      await page.evaluate(async (isDark) => {
        const { useThemeStore } = await window.storeModule('themeStore');
        useThemeStore
          .getState()
          .setTheme({ ...useThemeStore.getState().currentTheme, appearance: 'manual', isDark });
      }, isDark);
      await page.waitForTimeout(250);
      await page
        .locator('.project-context-page')
        .evaluate((element) => element.scrollTo({ top: 0 }));
      await page.screenshot({
        path: `output/playwright/context-${isDark ? 'dark' : 'light'}-${width}.png`,
      });
      assert.ok(
        await page
          .locator('.project-context-page')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      );
    }
  }
  await navigate('agents');
  await page.getByRole('button', { name: 'Configure Codex', exact: true }).waitFor();
  await page.getByText('CLI setup needed', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 840 });
  assert.equal(await page.locator('.agent-roster-row').count(), 4);
  await page.screenshot({ path: 'output/playwright/agents-grid.png' });
  assert.equal(await page.getByText('Ready', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Configure Codex', exact: true }).click();
  await page.getByRole('heading', { name: 'Configure Codex', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add code-model to model list', exact: true }).click();
  await page
    .getByRole('button', { name: 'Remove code-model from model list', exact: true })
    .waitFor();
  await page.setViewportSize({ width: 960, height: 640 });
  assert.ok(
    await page.locator('.agent-settings-page').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop > 0 && getComputedStyle(element).overflowY === 'auto';
    }),
  );
  await page.screenshot({ path: 'output/playwright/agent-settings-scroll.png' });
  await navigate('mcp-marketplace');
  await page.getByRole('heading', { name: 'MCP marketplace', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { useMcpStore } = await window.storeModule('mcpStore');
    const { useSettingsStore } = await window.storeModule('settingsStore');
    const server = {
      id: 'search-fixture',
      name: 'Trail Search',
      description:
        'Search and navigate project documentation with structured results and useful source references.',
      category: 'developer-tools',
      url: 'https://github.com/example/trail',
      isOfficial: true,
      isVerifiedActive: true,
      upvotes: 12,
      githubStars: 1234,
      npmDownloads: 0,
      qualityScore: 90,
      installName: 'trail-search',
      installConfidence: 'high',
      installNote: 'Requires a provider token.',
      installKind: 'remote',
      envVars: ['API_TOKEN'],
      claudeConfigSnippet: { mcpServers: { trail: { url: 'https://example.com/mcp' } } },
      detailUrl: 'https://example.com/listing',
    };
    const listing = () =>
      useMcpStore.setState({
        marketplaceServers: [server],
        loadingMarketplace: false,
        marketplaceError: null,
      });
    useMcpStore.setState({
      searchMarketplace: async () => listing(),
      inspectServer: async (server) =>
        useMcpStore.setState({
          inspectingServer: server,
          loadingMarkdown: false,
          inspectError: null,
          inspectingDetails: {
            description: server.description,
            license: 'MIT',
            authType: 'API token',
            pricingModel: 'Free tier',
            compatibleClients: ['Codex', 'Claude Code'],
            maintenanceStatus: 'Active',
            tools: [{ name: 'search_docs', description: 'Find relevant documentation.' }],
            readme: '# Trail Search\n\nSearch project documentation.',
          },
        }),
    });
    useSettingsStore.getState().setUseMcpMarketplace(true);
    listing();
  });
  const detailsButton = page.getByRole('button', { name: 'View details', exact: false });
  await detailsButton.click();
  await page.getByRole('heading', { name: 'Trail Search', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('tab', { name: 'Tools (1)', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search listed tools' }).fill('missing');
  await page.getByText('No tools match “missing”.', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  for (const width of [1280, 960, 700]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const isDark of [false, true]) {
      await page.evaluate(async (isDark) => {
        const { useThemeStore } = await window.storeModule('themeStore');
        useThemeStore
          .getState()
          .setTheme({ ...useThemeStore.getState().currentTheme, appearance: 'manual', isDark });
      }, isDark);
      await page.waitForTimeout(250);
      await page.screenshot({
        path: `output/playwright/mcp-page-${isDark ? 'dark' : 'light'}-${width}.png`,
      });
      assert.ok(
        await page
          .locator('.mcp-workspace')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      );
    }
  }
  await page.getByRole('button', { name: 'Configure server', exact: true }).click();
  await page.getByRole('heading', { name: 'Configure Trail Search', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByLabel('Variable 1 value', { exact: true }).fill('fixture-token');
  await page.screenshot({ path: 'output/playwright/mcp-configure-page.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Back to marketplace', exact: true }).click();
  assert.equal(await detailsButton.evaluate((element) => element === document.activeElement), true);
  assert.equal(
    await page.evaluate(() => window.pagesFixture.calls.includes('mcp_save_server')),
    false,
  );

  await page.getByRole('button', { name: 'Invitations, 3 left to give' }).waitFor();
  await navigate('mcps');
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const connectionDialog = page.getByRole('dialog');
  await connectionDialog.getByLabel('Name', { exact: true }).fill('Fixture tool');
  await connectionDialog.getByRole('button', { name: 'Remote URL', exact: true }).click();
  await connectionDialog.getByLabel('Endpoint URL').fill('https://example.com/mcp');
  await connectionDialog.getByRole('button', { name: 'All projects', exact: true }).click();
  await connectionDialog.getByRole('button', { name: 'Specific agents', exact: true }).click();
  await connectionDialog.getByRole('checkbox', { name: 'Claude Code', exact: true }).uncheck();
  assert.equal(
    await page.evaluate(
      () => window.pagesFixture.calls.filter((call) => call === 'mcp_save_server').length,
    ),
    0,
  );
  await page.setViewportSize({ width: 960, height: 640 });
  await page.screenshot({ path: 'output/playwright/mcp-add-960.png' });
  assert.ok(
    await connectionDialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
  );
  await connectionDialog.getByRole('button', { name: 'Add connection', exact: true }).click();
  await connectionDialog.waitFor({ state: 'hidden' });
  const savedConnection = await page.evaluate(() => window.pagesFixture.mcpSaved);
  assert.equal(savedConnection.scope, 'global');
  assert.deepEqual(savedConnection.agents, ['codex']);
  assert.equal(savedConnection.managed, true);
  assert.equal(savedConnection.discovery, true);
  await page.getByRole('button', { name: 'Browse marketplace', exact: true }).first().click();
  await page.getByRole('heading', { name: 'MCP marketplace', exact: true }).waitFor();
  await navigate('preferences');
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Allow Codex app-wide', exact: true }).waitFor();
  const permission = page.getByRole('switch', {
    name: 'Allow Codex account Work account',
    exact: true,
  });
  await permission.click();
  await page.waitForFunction(() =>
    window.pagesFixture.policy?.disabledAccounts?.codex?.includes('fixture-account'),
  );
  await permission.click();
  await page.getByRole('button', { name: 'Per project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Trail renamed');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('switch', { name: 'Use app theme', exact: true }).click();
  await page.getByRole('slider', { name: 'Color field', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(async () => {
      const { useProjectStore } = await window.storeModule('projectStore');
      return !!useProjectStore.getState().projects[0].preferences.theme;
    }),
    true,
  );
  await page.getByRole('switch', { name: 'Use app theme', exact: true }).click();
  await page.getByRole('button', { name: 'App-wide', exact: true }).click();
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  assert.equal(
    await page
      .locator('.activity-log [role="group"]')
      .evaluateAll((elements) =>
        elements.some((element) => element.scrollWidth > element.clientWidth),
      ),
    false,
  );
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'working', exact: true }).click();
  await page.locator('[data-mascot-effort]').waitFor();
  for (const width of [1280, 960, 700]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const isDark of [false, true]) {
      await page.evaluate(async (isDark) => {
        const { useThemeStore } = await window.storeModule('themeStore');
        useThemeStore
          .getState()
          .setTheme({ ...useThemeStore.getState().currentTheme, appearance: 'manual', isDark });
      }, isDark);
      await page.screenshot({
        path: `output/playwright/settings-${isDark ? 'dark' : 'light'}-${width}.png`,
      });
      assert.ok(
        await page
          .locator('.settings-page')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      );
    }
  }
  await navigate('project-settings');
  await page.getByLabel('Project name', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Project name', { exact: true }).inputValue(),
    'Trail renamed',
  );
  await page.screenshot({ path: 'output/playwright/project-settings-700.png' });
  await navigate('topology');
  await page.getByRole('heading', { name: 'Codebase', exact: true }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Project shortcuts' }).count(), 0);
  await page.getByRole('textbox', { name: 'Find a file', exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => window.pagesFixture.calls.filter((call) => call === 'codebase_scan').length,
    ),
    1,
  );
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.screenshot({ path: 'output/playwright/codebase-ready.png' });
  await page.getByRole('button', { name: /^Checks/ }).click();
  await page.getByRole('heading', { name: 'No findings in this snapshot' }).waitFor();
  await page.screenshot({ path: 'output/playwright/codebase-checks-empty.png' });
  await page.evaluate(() => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args) =>
      command === 'codebase_scan'
        ? {
            root: 'C:/fixture/trail',
            scannedAt: new Date().toISOString(),
            durationMs: 10,
            truncated: false,
            files: ['src/main.ts', 'src/helper.ts'].map((path) => ({
              path,
              language: 'TypeScript',
              lines: 10,
              bytes: 100,
              analyzed: true,
            })),
            references: [
              {
                source: 'src/main.ts',
                target: 'src/helper.ts',
                specifier: './helper',
                line: 1,
                kind: 'import',
                status: 'resolved',
              },
              {
                source: 'src/helper.ts',
                target: 'src/main.ts',
                specifier: './main',
                line: 1,
                kind: 'import',
                status: 'resolved',
              },
              {
                source: 'src/main.ts',
                target: null,
                specifier: './missing',
                line: 3,
                kind: 'import',
                status: 'unresolved',
              },
            ],
            cycles: [],
            diagnostics: [
              { path: 'src/helper.ts', message: 'Some computed imports could not be analyzed.' },
            ],
          }
        : invoke(command, args);
  });
  await page.getByRole('button', { name: /Refresh map|Update map/ }).click();
  await page.getByRole('heading', { name: '2 connected files', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Search checks' }).fill('missing');
  await page.getByRole('button', { name: /Target not resolved.*missing/ }).waitFor();
  await page.getByRole('textbox', { name: 'Search checks' }).fill('');

  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: width === 1280 ? 840 : 640 });
    for (const isDark of [false, true]) {
      await page.evaluate(async (isDark) => {
        const { useThemeStore } = await window.storeModule('themeStore');
        useThemeStore
          .getState()
          .setTheme({ ...useThemeStore.getState().currentTheme, appearance: 'manual', isDark });
      }, isDark);
      await page.screenshot({
        path: `output/playwright/checks-${isDark ? 'dark' : 'light'}-${width}.png`,
      });
      assert.ok(
        await page
          .locator('.codebase-page')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      );
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await navigate('preferences');
  await page
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: 'Appearance', exact: true })
    .click();
  await page.getByRole('button', { name: 'working', exact: true }).click();
  await page.waitForTimeout(400);
  const pose = await page.locator('[data-mascot-effort] path').first().getAttribute('style');
  await page.waitForTimeout(450);
  assert.equal(await page.locator('[data-mascot-effort] path').first().getAttribute('style'), pose);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await navigate('usage');
  await page.getByRole('heading', { name: 'Usage & Intelligence', exact: true }).waitFor();
  await page.getByText('80% remaining', { exact: true }).waitFor();
  const capacityCalls = () =>
    page.evaluate(
      () => window.pagesFixture.calls.filter((command) => command === 'capacity_snapshot').length,
    );
  assert.equal(await capacityCalls(), 1);
  await navigate('agents');
  await page.getByRole('heading', { name: 'Agents', exact: true }).waitFor();
  await navigate('usage');
  await page.getByRole('heading', { name: 'Usage & Intelligence', exact: true }).waitFor();
  assert.equal(await capacityCalls(), 1);
  await page.evaluate(async () => {
    const { useCapacityStore } = await window.storeModule('capacityStore');
    useCapacityStore.setState({ lastFetched: Date.now() - 360_000 });
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(
    () =>
      window.pagesFixture.calls.filter((command) => command === 'capacity_snapshot').length === 2,
  );
  await page.evaluate(async () => {
    const { useCapacityStore } = await window.storeModule('capacityStore');
    useCapacityStore.setState({ lastFetched: Date.now() - 61_000 });
  });
  await page.getByRole('button', { name: 'Refresh capacity', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.pagesFixture.calls.filter((command) => command === 'capacity_snapshot').length === 3,
  );
  await page.getByRole('button', { name: 'Agent Performance & Insights', exact: true }).click();
  const handoffToggle = page.getByRole('switch', { name: 'Automatic quota handoff', exact: true });
  assert.equal(await handoffToggle.getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('.capacity-panel').count(), 0);
  assert.equal(await page.getByText('Protected', { exact: true }).count(), 0);
  await handoffToggle.click();
  await page.waitForFunction(async () => {
    const { useAgentConfigStore } = await window.storeModule('agentConfigStore');
    return !useAgentConfigStore.getState().automaticQuotaHandoff;
  });
  await navigate('agents');
  await page.getByRole('heading', { name: 'Agents', exact: true }).waitFor();
  await navigate('usage');
  await page.getByRole('button', { name: 'Agent Performance & Insights', exact: true }).click();
  assert.equal(await handoffToggle.getAttribute('aria-checked'), 'false');
  await handoffToggle.click();

  for (const tab of [
    'usage',
    'project-knowledge',
    'repo-todos',
    'agent-settings',
    'mcp-marketplace',
  ]) {
    await page.setViewportSize({ width: 1800, height: 840 });
    await navigate(tab);
    const selector =
      tab === 'usage'
        ? '.usage-page'
        : tab === 'project-knowledge'
          ? '.project-context-page'
          : tab === 'repo-todos'
            ? '.repo-todos'
            : tab === 'agent-settings'
              ? '.agent-settings-page'
              : '.mcp-workspace';
    await page.locator(selector).waitFor();
    assert.ok(
      await page
        .locator(selector)
        .evaluate(
          (element) =>
            Math.abs(
              element.getBoundingClientRect().right -
                document.querySelector('.workspace-canvas').getBoundingClientRect().right,
            ) < 2,
        ),
      `${tab} page scrollbar reaches the canvas edge`,
    );
  }
  await navigate('usage');
  await page.screenshot({ path: 'output/playwright/usage-edge-scroll.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Workspace page browser checks passed: safe TODO clicks, reviewed capture, discard, context detail, agent grid/scroll, MCP page navigation and cancel.',
  );
} finally {
  await browser.close();
}
