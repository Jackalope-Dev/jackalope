import assert from 'node:assert/strict';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Checks GitLab and Bitbucket delivery against fixtures: host words on the Delivery card,
// merge methods each host allows, follow-up drafts with failed job output, hidden
// actions, and the Connected work settings for code hosts. Needs the desktop preview
// (JACKALOPE_PREVIEW_URL); runs no agent and reaches no GitLab or Bitbucket account.
const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5192';
const output = 'output/playwright/code-hosts';
await mkdir(output, { recursive: true });
const fixture = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { TaskDelivery } from '/src/components/tasks/TaskDelivery.tsx';
import { CodeHosts } from '/src/components/settings/CodeHosts.tsx';
import { usePullRequestStore } from '/src/stores/pullRequestStore.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/tasks/core-workflow.css';
const at = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const run = (id, project) => ({ id, taskId: id, projectId: project, projectName: project, projectPath: '/fixture/' + project, workspace: '/fixture/' + project + '/.worktrees/' + id, branch: 'jackalope/' + id, targetBranch: 'main', agent: 'codex', status: 'review', startedAt: at(3), endedAt: at(2), result: 'Done.', prompt: id, prompts: [], sessionId: 's-' + id, logs: [], usage: {}, activity: [] });
const capabilities = (kind, issues = true) => ({ create: true, draft: true, merge: true, mergeMethods: kind === 'gitlab' ? ['merge', 'squash'] : ['merge', 'squash', 'fastForward'], follow: true, reviewThreads: true, ciLogs: true, issues, changeRequestList: true });
const hosts = {
  '/fixture/web': { kind: 'gitlab', recognized: true, host: 'gitlab.com', repository: 'acme/platform/web', chosen: null, capabilities: capabilities('gitlab'), access: { state: 'ready', message: 'Signed in to gitlab.com as ana.' } },
  '/fixture/api': { kind: 'bitbucket', recognized: true, host: 'bitbucket.org', repository: 'acme/api', chosen: null, capabilities: capabilities('bitbucket', false), access: { state: 'notConnected', message: 'Connect Bitbucket in Settings → Connected work with your Atlassian email and a Bitbucket API token.' } },
};
const f = window.hostFixture = { calls: [], handoffs: [], open: 'web', gitlab: { 'gitlab.com': { state: 'signedOut', message: 'The GitLab CLI is not signed in to gitlab.com. Run \`glab auth login --hostname gitlab.com\`, then retry. glab said: 401 Unauthorized' } },
  theme: (dark) => useThemeStore.getState().setAppTheme({ ...useThemeStore.getState().appTheme, isDark: dark, appearance: 'manual' }),
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 0, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
  f.calls.push({ command, ...args });
  switch (command) {
    case 'project_source_control': return hosts[args.projectPath];
    case 'project_github_context': return { title: 'Pipeline', url: 'https://gitlab.com/acme/platform/web/-/pipelines/3109717199', text: 'Failed job output:\\n--- unit (test) ---\\nFAIL src/cart.test.ts', truncated: false };
    case 'source_control_settings': return { hosts: [{ host: 'git.corp.example', kind: 'gitlab' }], bitbucket: null };
    case 'gitlab_cli_status': return f.gitlab[args.host] ?? { state: 'ready', message: 'Signed in to ' + args.host + ' as ana.' };
    case 'bitbucket_connection_save': return { email: args.email, name: 'Ana Author', scopes: [] };
    case 'source_control_host_save': return [{ host: 'git.corp.example', kind: 'gitlab' }, { host: args.host, kind: args.kind }];
    case 'plugin:event|listen': return 0;
    default: return null;
  }
}};
useProjectStore.setState({ activeProjectId: 'web', projects: ['web', 'api'].map((id) => ({ id, name: id, path: '/fixture/' + id, gitBranch: 'main', worktrees: [], agentProvider: 'codex', preferences: {} })) });
const tracked = (taskId, extra) => ({ taskId, runId: taskId, number: 42, failing: [], pending: 0, checks: 5, headRefOid: 'abc', checkedAt: at(0.01), ...extra });
usePullRequestStore.setState({ tracked: {
  web: tracked('web', { provider: 'gitlab', url: 'https://gitlab.com/acme/platform/web/-/merge_requests/42', phase: 'failing', failing: ['unit'], pipeline: '3109717199', mergeMethods: ['merge', 'squash'] }),
  webReady: tracked('webReady', { provider: 'gitlab', url: 'https://gitlab.com/acme/platform/web/-/merge_requests/43', number: 43, phase: 'ready', mergeMethods: ['squash'] }),
  api: tracked('api', { provider: 'bitbucket', url: 'https://bitbucket.org/acme/api/pull-requests/7', number: 7, phase: 'ready', mergeMethods: ['merge', 'squash', 'fastForward'] }),
} });
const runs = { web: run('web', 'web'), webReady: run('webReady', 'web'), api: run('api', 'api'), fresh: run('fresh', 'web') };
function Harness() {
  const [open, setOpen] = React.useState(f.open);
  f.show = setOpen;
  const current = runs[open];
  return React.createElement('main', { style: { height: '100vh', overflow: 'auto', padding: 24, display: 'grid', gap: 24, alignContent: 'start' } },
    open === 'settings'
      ? React.createElement(CodeHosts)
      : React.createElement('div', { id: 'delivery' }, React.createElement(TaskDelivery, { key: current.id, run: current, onHandoff: (text) => { f.handoffs.push({ to: 'draft', text }); }, onFollowUp: (text) => { f.handoffs.push({ to: 'task', text }); } })));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const fixturePath = `apps/desktop/scratch/code-hosts-${process.pid}.tsx`;
await mkdir('apps/desktop/scratch', { recursive: true });
await writeFile(fixturePath, fixture);
const browser = await chromium.launch({
  channel: process.env.UI_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/src/main.tsx*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `import "/scratch/code-hosts-${process.pid}.tsx";`,
    }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const show = (id) => page.evaluate((id) => window.hostFixture.show(id), id);
  const calls = (command) =>
    page.evaluate(
      (command) => window.hostFixture.calls.filter((c) => c.command === command),
      command,
    );

  // A GitLab merge request uses GitLab's words and drafts a fix with the failed job output.
  const card = page.getByRole('region', { name: 'Merge request', exact: true });
  await card.waitFor();
  assert.match(await card.innerText(), /Merge request !42[\s\S]*MR pipeline failed/);
  assert.match(await card.innerText(), /Open on GitLab/);
  await card.getByRole('button', { name: 'Ask the agent to fix' }).click();
  await page.waitForFunction(() => window.hostFixture.handoffs.length === 1);
  const [handoff] = await page.evaluate(() => window.hostFixture.handoffs);
  assert.equal(handoff.to, 'task');
  assert.match(handoff.text, /failing pipeline jobs on this task's merge request/);
  assert.match(handoff.text, /FAIL src\/cart\.test\.ts/);
  assert.deepEqual(
    (await calls('project_github_context')).map((c) => [c.kind, c.number]),
    [['ci', '3109717199']],
  );
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Check merge request and pipeline' }).waitFor();
  await page.keyboard.press('Escape');
  for (const dark of [false, true]) {
    await page.evaluate((dark) => window.hostFixture.theme(dark), dark);
    await page.waitForTimeout(300);
    await card.screenshot({ path: `${output}/gitlab-card-${dark ? 'dark' : 'light'}.png` });
  }
  await page.evaluate(() => window.hostFixture.theme(false));

  // A project that only squashes offers no method choice; the confirmation names GitLab's rules.
  await show('webReady');
  await card.getByRole('button', { name: 'Merge', exact: true }).click();
  let dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /on GitLab[\s\S]*pipeline, approvals and threads/);
  assert.equal(await dialog.getByText('Merge method').count(), 0);
  await dialog.screenshot({ path: `${output}/gitlab-merge.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  // Opening a new one says merge request and names the GitLab CLI.
  await show('fresh');
  await page.getByRole('button', { name: 'Create merge request' }).waitFor();

  // Bitbucket keeps "pull request", offers its merge strategies and says the token is missing.
  await show('api');
  const bitbucket = page.getByRole('region', { name: 'Pull request', exact: true });
  await bitbucket.waitFor();
  assert.match(await bitbucket.innerText(), /Pull request #7[\s\S]*PR ready to merge/);
  await page.getByText('Connect Bitbucket in Settings').waitFor();
  await bitbucket.getByRole('button', { name: 'Merge pull request' }).click();
  dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /on Bitbucket with your API token/);
  await dialog.getByRole('combobox').click();
  const methods = await page.getByRole('option').allInnerTexts();
  assert.deepEqual(methods, ['Merge commit', 'Squash and merge', 'Fast-forward']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await calls('task_pull_request_merge')).length, 0);
  for (const width of [960, 1280]) {
    await page.setViewportSize({ width, height: 640 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1280, height: 840 });

  // Settings: glab's real message, self-managed hosts and the guided Bitbucket token.
  await show('settings');
  const hosts = page.getByRole('region', { name: 'Code hosts', exact: true });
  await hosts.waitFor();
  await hosts.getByText('glab auth login --hostname gitlab.com').waitFor();
  assert.match(await hosts.innerText(), /git\.corp\.example/);
  await hosts.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByText('write:pullrequest:bitbucket').waitFor();
  await page.getByRole('button', { name: 'I have a token' }).click();
  const email = page.getByLabel('Atlassian account email');
  await email.focus();
  await page.keyboard.type('ana@example.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type('ATATT-fixture');
  for (const dark of [false, true]) {
    await page.evaluate((dark) => window.hostFixture.theme(dark), dark);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `${output}/settings-${dark ? 'dark' : 'light'}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Connect', exact: true }).last().click();
  await page.getByText('Bitbucket connected as Ana Author.').waitFor();
  const [saved] = await calls('bitbucket_connection_save');
  assert.deepEqual([saved.email, saved.token], ['ana@example.com', 'ATATT-fixture']);
  for (const width of [960, 1280]) {
    await page.setViewportSize({ width, height: 640 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
  console.log(`Code host checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await unlink(fixturePath).catch(() => {});
}
