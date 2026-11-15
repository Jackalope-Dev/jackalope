import assert from 'node:assert/strict';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Checks followed pull requests against fixtures: work list lanes, the Delivery card and
// its follow-up drafts. Needs the desktop preview (JACKALOPE_PREVIEW_URL); runs no agent
// and reaches no GitHub repository.
const url = process.env.JACKALOPE_PREVIEW_URL ?? 'http://127.0.0.1:5192';
const output = 'output/playwright/pull-requests';
await mkdir(output, { recursive: true });
const fixture = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { TaskCollection } from '/src/components/tasks/TaskCollection.tsx';
import { TaskDelivery } from '/src/components/tasks/TaskDelivery.tsx';
import { collectWork } from '/src/lib/task-collection.ts';
import { usePullRequestStore } from '/src/stores/pullRequestStore.ts';
import { useProjectStore } from '/src/stores/projectStore.ts';
import { useThemeStore } from '/src/stores/themeStore.ts';
import '/src/index.css';
import '/src/components/tasks/task-workspace.css';
import '/src/components/tasks/core-workflow.css';
const at = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const run = (id, title, extra = {}) => ({ id, taskId: id, projectId: 'shop', projectName: 'Shop', projectPath: '/fixture/shop', workspace: '/fixture/shop/.worktrees/' + id, branch: 'jackalope/' + id, targetBranch: 'main', agent: 'codex', status: 'review', startedAt: at(3), endedAt: at(2), result: 'Done.', prompt: title, prompts: [], sessionId: 's-' + id, logs: [], usage: {}, activity: [], ...extra });
const runs = [
  run('failing', 'Speed up search'),
  run('changes', 'Add CSV export'),
  run('checking', 'Tidy the settings page'),
  run('review', 'Cache product images'),
  run('ready', 'Fix the cart total'),
  run('merged', 'Rename the checkout route'),
  run('plain', 'Write onboarding copy'),
  run('working', 'Migrate the price table', { status: 'running', endedAt: null }),
];
const pr = (taskId, phase, number, extra = {}) => ({ taskId, runId: taskId, url: 'https://github.com/acme/shop/pull/' + number, number, phase, failing: [], pending: 0, checks: 4, headRefOid: 'abc', checkedAt: at(0.01), ...extra });
const f = window.prFixture = { calls: [], handoffs: [],
  theme: (dark) => useThemeStore.getState().setAppTheme({ ...useThemeStore.getState().appTheme, isDark: dark, appearance: 'manual' }),
  view: { url: 'https://github.com/acme/shop/pull/11', number: 11, state: 'OPEN', headRefOid: 'abc', mergeable: 'MERGEABLE', reviewDecision: '', statusCheckRollup: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }] },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 0, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
  f.calls.push({ command, ...args });
  switch (command) {
    case 'task_pull_request_status': return f.view;
    case 'project_github_context': return { title: 'PR', url: f.view.url, text: '{"reviewThreads":"Use a streaming writer."}', truncated: false };
    case 'plugin:event|listen': return 0;
    default: return null;
  }
}};
useProjectStore.setState({ activeProjectId: 'shop', projects: [{ id: 'shop', name: 'Shop', path: '/fixture/shop', gitBranch: 'main', worktrees: [], agentProvider: 'codex', preferences: {} }] });
usePullRequestStore.setState({ tracked: {
  failing: pr('failing', 'failing', 11, { failing: ['build', 'lint'] }),
  changes: pr('changes', 'changes', 12),
  checking: pr('checking', 'checking', 13, { pending: 2 }),
  review: pr('review', 'review', 14),
  ready: pr('ready', 'ready', 15),
  merged: pr('merged', 'merged', 16),
  working: pr('working', 'failing', 17, { failing: ['build'] }),
} });
function Harness() {
  const tracked = usePullRequestStore((state) => state.tracked);
  const [view, setView] = React.useState({ filter: 'all', layout: 'list', query: '' });
  const [open, setOpen] = React.useState('failing');
  const items = collectWork('shop', [], runs, [], false, false, tracked);
  const current = runs.find((item) => item.id === open);
  return React.createElement('main', { style: { height: '100vh', overflow: 'auto', padding: 24, display: 'grid', gap: 24, alignContent: 'start' } },
    React.createElement(TaskCollection, { items, view, onViewChange: setView, onOpen: (item) => setOpen(item.run.id) }),
    React.createElement('div', { id: 'delivery' }, React.createElement(TaskDelivery, { key: current.id, run: current, onHandoff: (text) => { f.handoffs.push({ to: 'draft', text }); }, onFollowUp: (text) => { f.handoffs.push({ to: 'task', text }); } })));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
const fixturePath = `apps/desktop/scratch/pull-requests-${process.pid}.tsx`;
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
      body: `import "/scratch/pull-requests-${process.pid}.tsx";`,
    }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // The list groups work by what the pull request needs.
  const group = (name) => page.getByRole('region', { name, exact: true });
  const titles = (name) => group(name).locator('.work-item-title').allInnerTexts();
  await group('Needs you').waitFor();
  assert.deepEqual((await titles('Needs you')).sort(), [
    'Add CSV export',
    'Fix the cart total',
    'Speed up search',
    'Write onboarding copy',
  ]);
  assert.deepEqual((await titles('In review')).sort(), [
    'Cache product images',
    'Tidy the settings page',
  ]);
  // Running work keeps its lane whatever its pull request says.
  assert.deepEqual(await titles('Working'), ['Migrate the price table']);
  const row = (title) => page.locator('.work-item', { hasText: title });
  assert.match(await row('Speed up search').innerText(), /PR checks failed[\s\S]*Fix checks/);
  assert.match(await row('Add CSV export').innerText(), /Changes requested[\s\S]*Address review/);
  assert.match(
    await row('Fix the cart total').innerText(),
    /PR ready to merge[\s\S]*Merge pull request/,
  );
  assert.match(await row('Cache product images').innerText(), /Waiting for review/);
  for (const dark of [false, true]) {
    await page.evaluate((dark) => window.prFixture.theme(dark), dark);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${output}/list-${dark ? 'dark' : 'light'}.png`,
      fullPage: true,
    });
  }
  await page.evaluate(() => window.prFixture.theme(false));

  // The board gives pull requests waiting on GitHub their own lane.
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  const lanes = await page.locator('.work-column h2').allInnerTexts();
  assert.deepEqual(
    lanes.map((lane) => lane.replace(/\s*\d+$/, '')),
    ['Needs you', 'Working', 'In review', 'Drafts', 'Finished'],
  );
  assert.equal(await page.locator('.work-column[aria-label="In review"] .work-item').count(), 2);
  assert.equal(await page.locator('.work-column[aria-label="Finished"] .work-item').count(), 1);
  await page.screenshot({ path: `${output}/board.png`, fullPage: true });
  for (const width of [960, 1280]) {
    await page.setViewportSize({ width, height: 640 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1280, height: 840 });

  // Delivery shows the pull request and one next step, drafted for the task's own agent.
  const card = page.getByRole('region', { name: 'Pull request', exact: true });
  await card.waitFor();
  assert.match(
    await card.innerText(),
    /Pull request #11[\s\S]*PR checks failed[\s\S]*2 of 4 checks failed/,
  );
  assert.match(await card.innerText(), /Failed: build, lint/);
  assert.equal(await page.getByRole('button', { name: 'Create pull request' }).count(), 0);
  await card.getByRole('button', { name: 'Ask the agent to fix' }).click();
  await page.waitForFunction(() => window.prFixture.handoffs.length === 1);
  let [handoff] = await page.evaluate(() => window.prFixture.handoffs);
  assert.equal(handoff.to, 'task');
  assert.match(handoff.text, /pull\/11[\s\S]*- build\n- lint/);
  await card.screenshot({ path: `${output}/card-failing.png` });

  // Requested changes carry GitHub's review threads into the draft.
  await row('Add CSV export').click();
  await card.getByRole('button', { name: 'Ask the agent to address it' }).click();
  await page.waitForFunction(() => window.prFixture.handoffs.length === 2);
  handoff = (await page.evaluate(() => window.prFixture.handoffs))[1];
  assert.match(handoff.text, /Use a streaming writer/);

  // A ready pull request offers merging behind a confirmation that names the effect.
  await row('Fix the cart total').click();
  await card.getByRole('button', { name: 'Merge pull request' }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /on GitHub[\s\S]*deploys/);
  await dialog.screenshot({ path: `${output}/merge-dialog.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(
      () => window.prFixture.calls.filter((c) => c.command === 'task_pull_request_merge').length,
    ),
    0,
  );

  // Checking GitHub replaces the saved state with what it reports.
  await row('Speed up search').click();
  await card.getByRole('button', { name: 'Pull request options' }).click();
  await page.getByRole('menuitem', { name: 'Check GitHub now' }).click();
  await page.waitForFunction(() =>
    window.prFixture.calls.some((c) => c.command === 'task_pull_request_status'),
  );
  await card.getByText('PR ready to merge').waitFor();
  assert.match(await card.innerText(), /1 check passed/);

  // Stopping removes the card and offers a new pull request again.
  await card.getByRole('button', { name: 'Pull request options' }).click();
  await page.getByRole('menuitem', { name: 'Stop following this pull request' }).click();
  await card.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Create pull request' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`Pull request checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await unlink(fixturePath).catch(() => {});
}
