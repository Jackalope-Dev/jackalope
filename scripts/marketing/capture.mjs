import { copyFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const origin = process.env.DESKTOP_PREVIEW_ORIGIN || 'http://127.0.0.1:5177';
const output = 'output/growth-redesign';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 840 },
  reducedMotion: 'reduce',
  recordVideo: { dir: output, size: { width: 1440, height: 840 } },
});
const page = await context.newPage();
page.on('pageerror', (error) => console.error(error.message));
await page.goto(origin);
await page.evaluate(async () => {
  const { useOnboardingStore } = await import('/src/stores/onboardingStore.ts');
  const { useProjectStore } = await import('/src/stores/projectStore.ts');
  const { useTaskStore } = await import('/src/stores/taskStore.ts');
  const { useExecutionStore } = await import('/src/stores/executionStore.ts');
  useOnboardingStore.getState().finish();
  const project = {
    id: 'atlas',
    name: 'Atlas',
    path: 'C:/Projects/atlas',
    gitBranch: 'main',
    worktrees: [],
    agentProvider: 'codex',
  };
  useProjectStore.setState({ projects: [project], activeProjectId: 'atlas' });
  const time = '2026-09-08T15:00:00Z';
  const sample = (id, prompt, status, agent) => ({
    id,
    taskId: id,
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    workspace: `${project.path}/.worktrees/${id}`,
    branch: `jackalope/${id}`,
    baseHead: 'sample',
    agent,
    account: 'Atlas sample account',
    model: null,
    prompt,
    status,
    startedAt: time,
    endedAt: status === 'running' ? null : time,
    sessionId: null,
    result:
      '## Keyboard search, ready for review\n\nThe search dialog now keeps focus inside the results and returns it to the trigger on close.\n\n- Arrow keys move between matches.\n- Escape closes the dialog.\n- Empty results keep a clear next step.\n\n### Review before integration\n\nInspect the change, check narrow layouts, and confirm focus returns correctly. This is fictional Atlas sample data.',
    activity: [],
    diagnostics: [],
    error: null,
    persistenceError: null,
    exitCode: status === 'review' ? 0 : null,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reported: false,
      estimatedCostUsd: null,
    },
    validationSteps: [],
    screenshots: [],
    prompts: [],
  });
  const review = sample('search', 'Add keyboard search to the project', 'review', 'codex');
  const working = sample('settings', 'Polish settings for narrow windows', 'running', 'claude');
  const question = sample('navigation', 'Simplify the project navigation', 'running', 'codex');
  working.result = '';
  question.result = '';
  question.prompts = [
    {
      id: 'question',
      runId: question.id,
      question: 'Should project navigation stay visible in narrow windows?',
      inputType: 'choice',
      options: ['Keep it visible', 'Use a menu'],
      status: 'pending',
      createdAt: time,
    },
  ];
  useExecutionStore.setState({
    runs: [review, working, question],
    runners: [
      {
        id: 'codex',
        name: 'Codex',
        available: true,
        signedIn: true,
        account: 'Sample account',
        detail: 'Sample configuration',
      },
      {
        id: 'claude',
        name: 'Claude Code',
        available: true,
        signedIn: true,
        account: 'Sample account',
        detail: 'Sample configuration',
      },
      {
        id: 'grok',
        name: 'Grok',
        available: false,
        signedIn: false,
        account: '',
        detail: 'Not configured in this sample',
      },
      {
        id: 'opencode',
        name: 'OpenCode',
        available: false,
        signedIn: false,
        account: '',
        detail: 'Not configured in this sample',
      },
    ],
    loading: false,
    error: null,
    refresh: async () => {},
    discover: async () => {},
  });
  useTaskStore.setState({
    tasks: [
      {
        id: 'idea',
        projectId: 'atlas',
        title: 'Make project search feel instant',
        rawPrompt: 'Explore faster project search.',
        status: 'backlog',
        createdAt: time,
        updatedAt: time,
      },
    ],
  });
});
await page.getByRole('group', { name: 'Focus your work' }).waitFor();
await page.evaluate(() => document.fonts.ready);
async function theme(dark) {
  await page.evaluate(async (isDark) => {
    const { useThemeStore } = await import('/src/stores/themeStore.ts');
    const store = useThemeStore.getState();
    store.setTheme({ ...store.currentTheme, isDark, appearance: 'manual' });
  }, dark);
  await page.waitForTimeout(300);
}
async function capture(name) {
  await page.screenshot({ path: `apps/website/public/media/${name}.png` });
}
for (const dark of [false, true]) {
  await theme(dark);
  await capture(`tasks${dark ? '' : '-light'}`);
}
await theme(false);
await page.getByRole('button', { name: /Add keyboard search to the project/ }).click();
await page.getByRole('heading', { name: 'Add keyboard search to the project' }).waitFor();
await page.waitForTimeout(1000);
for (const dark of [false, true]) {
  await theme(dark);
  await capture(`review${dark ? '' : '-light'}`);
}
await page.getByRole('button', { name: 'Agents', exact: true }).click();
await page.waitForTimeout(600);
for (const dark of [false, true]) {
  await theme(dark);
  await capture(`agents${dark ? '' : '-light'}`);
}
await theme(false);
await page.getByRole('button', { name: 'Tasks', exact: true }).click();
await page.evaluate(async () => {
  const { useExecutionStore } = await import('/src/stores/executionStore.ts');
  useExecutionStore.setState({ selectedId: null });
});
await page.getByRole('group', { name: 'Focus your work' }).waitFor();
const started = Date.now();
const at = async (seconds) =>
  page.waitForTimeout(Math.max(0, started + seconds * 1000 - Date.now()));
await at(5);
await page
  .getByRole('group', { name: 'Focus your work' })
  .getByRole('button', { name: /Ready to review/ })
  .click();
await at(9);
await page
  .getByRole('group', { name: 'Focus your work' })
  .getByRole('button', { name: /Ready to review/ })
  .click();
await page.getByRole('button', { name: 'Board', exact: true }).click();
await at(14);
await page.getByRole('button', { name: /Simplify the project navigation/ }).click();
await at(20);
await page.getByRole('button', { name: 'All tasks', exact: true }).click();
await page.getByRole('button', { name: /Add keyboard search to the project/ }).click();
await at(27);
await page.getByRole('button', { name: 'Agents', exact: true }).click();
await at(34);
await theme(true);
await at(40);
const video = page.video();
await context.close();
copyFileSync(await video.path(), `${output}/walkthrough-raw.webm`);
await browser.close();
console.log('Captured current app components with fictional Atlas data; no native tasks executed.');
